#!/usr/bin/env python3
"""StockLens 的只读 HTTP 行情 API。

为什么还要这一层：
  · Electron 桌面用 stdio sidecar；浏览器/Web 端需要一个普通的 HTTP 入口；
  · 先把「协议 + 解析」复用成 JSON API，Web UI 才能和桌面共用同一套数据语义。

实现刻意只用标准库：ThreadingHTTPServer + json。单用户本地服务，所有 Bridge
调用串行化（TdxConnection 不是线程安全的），默认只绑 127.0.0.1。
"""

from __future__ import annotations

import argparse
import json
import mimetypes
import sys
import threading
import time
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, unquote, urlparse

from tdx_bridge import Bridge, TdxError

MAX_BODY_BYTES = 1024 * 1024


class TdxApiServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(
        self,
        address: tuple[str, int],
        bridge: Bridge,
        web_dir: str | Path | None = None,
    ):
        super().__init__(address, ApiHandler)
        self.bridge = bridge
        self.lock = threading.Lock()
        self.web_dir = Path(web_dir).resolve() if web_dir else None


class ApiHandler(BaseHTTPRequestHandler):
    server: TdxApiServer

    def log_message(self, format: str, *args: Any) -> None:  # noqa: A002
        print(f"[api] {self.address_string()} {format % args}", file=sys.stderr)

    def _cors(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _json(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode(
            "utf-8"
        )
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def _ok(self, result: Any) -> None:
        self._json(HTTPStatus.OK, {"ok": True, "result": result})

    def _stream(self, query: dict[str, str]) -> None:
        """SSE 行情流：先落地推送语义，避免 Web 端只能 3 秒轮询。"""
        codes = [
            code.strip()
            for code in query.get("codes", "").split(",")
            if code.strip()
        ]
        if not codes:
            self._error(HTTPStatus.BAD_REQUEST, "codes 不能为空")
            return
        try:
            interval = max(1000, min(60_000, int(query.get("interval", "3000"))))
        except ValueError:
            self._error(HTTPStatus.BAD_REQUEST, "interval 不合法")
            return

        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self.send_header("X-Accel-Buffering", "no")
        self._cors()
        self.end_headers()
        self.close_connection = True
        try:
            while True:
                try:
                    with self.server.lock:
                        quotes = self.server.bridge.quotes(codes)
                    payload = {
                        "ok": True,
                        "result": {"quotes": quotes, "at": int(time.time() * 1000)},
                    }
                    self.wfile.write(
                        f"data: {json.dumps(payload, ensure_ascii=False)}\n\n".encode(
                            "utf-8"
                        )
                    )
                    self.wfile.flush()
                except (BrokenPipeError, ConnectionResetError):
                    return
                except Exception as error:  # noqa: BLE001
                    message = json.dumps(
                        {"ok": False, "error": str(error)}, ensure_ascii=False
                    )
                    try:
                        self.wfile.write(f"event: error\ndata: {message}\n\n".encode())
                        self.wfile.flush()
                    except OSError:
                        pass
                    return
                time.sleep(interval)
        finally:
            self.close_connection = True

    def _error(self, status: int, message: str) -> None:
        self._json(status, {"ok": False, "error": message})

    def _static(self, path: str, head_only: bool = False) -> None:
        """托管 out/web；找不到的 SPA 路径回退 index.html。"""
        web_dir = self.server.web_dir
        if web_dir is None or not web_dir.is_dir():
            self._error(HTTPStatus.NOT_FOUND, "Web 产物不存在，请先 npm run build:web")
            return
        relative = unquote(path).lstrip("/") or "index.html"
        try:
            candidate = (web_dir / relative).resolve()
            candidate.relative_to(web_dir)
        except (OSError, ValueError):
            self._error(HTTPStatus.FORBIDDEN, "非法路径")
            return
        if candidate.is_dir():
            candidate = candidate / "index.html"
        if not candidate.is_file():
            if "." not in Path(relative).name:
                candidate = web_dir / "index.html"
            else:
                self._error(HTTPStatus.NOT_FOUND, "文件不存在")
                return
        if not candidate.is_file():
            self._error(HTTPStatus.NOT_FOUND, "文件不存在")
            return
        data = candidate.read_bytes()
        content_type = mimetypes.guess_type(candidate.name)[0] or "application/octet-stream"
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        if candidate.name == "index.html":
            self.send_header("Cache-Control", "no-cache")
        else:
            self.send_header("Cache-Control", "public, max-age=31536000, immutable")
        self.end_headers()
        if head_only:
            return
        try:
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _body(self) -> dict[str, Any]:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError as error:
            raise TdxError("Content-Length 不合法") from error
        if length < 0 or length > MAX_BODY_BYTES:
            raise TdxError("请求体过大或长度不合法")
        raw = self.rfile.read(length) if length else b"{}"
        try:
            payload = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise TdxError("请求体不是合法 JSON") from error
        if not isinstance(payload, dict):
            raise TdxError("请求体必须是 JSON 对象")
        return payload

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(HTTPStatus.NO_CONTENT)
        self._cors()
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        query = {key: values[-1] for key, values in parse_qs(parsed.query).items()}
        try:
            if parsed.path == "/api/stream":
                self._stream(query)
                return
            if parsed.path == "/api/ping":
                self._ok("pong")
                return
            if parsed.path == "/api/code_list":
                with self.server.lock:
                    self._ok(self.server.bridge.code_list())
                return
            if parsed.path == "/api/kline":
                with self.server.lock:
                    self._ok(
                        self.server.bridge.kline(
                            query.get("code", ""),
                            query.get("period", "day"),
                            int(query.get("count", "200")),
                        )
                    )
                return
            if parsed.path == "/api/minute":
                with self.server.lock:
                    self._ok(self.server.bridge.minute(query.get("code", "")))
                return
            if parsed.path == "/api/five_day":
                with self.server.lock:
                    self._ok(self.server.bridge.five_day(query.get("code", "")))
                return
            if not parsed.path.startswith("/api/"):
                self._static(parsed.path)
                return
            self._error(HTTPStatus.NOT_FOUND, f"未知路径：{parsed.path}")
        except (TdxError, ValueError, TypeError) as error:
            self._error(HTTPStatus.BAD_REQUEST, str(error))
        except Exception as error:  # noqa: BLE001 - 服务端要给出可读错误
            self._error(HTTPStatus.INTERNAL_SERVER_ERROR, str(error))

    def do_HEAD(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/"):
            self._error(HTTPStatus.METHOD_NOT_ALLOWED, "API 请使用 GET/POST")
            return
        self._static(parsed.path, head_only=True)

    def do_POST(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        try:
            payload = self._body()
            if parsed.path == "/api/ping":
                self._ok("pong")
                return
            if parsed.path == "/api/quotes":
                codes = payload.get("codes") or []
                if not isinstance(codes, list):
                    raise TdxError("codes 必须是数组")
                with self.server.lock:
                    self._ok(self.server.bridge.quotes(codes))
                return
            if parsed.path == "/api/category":
                with self.server.lock:
                    self._ok(
                        self.server.bridge.category_quotes(
                            category=int(payload.get("category", 6)),
                            sort_type=int(
                                payload.get("sortType", payload.get("sort_type", 0))
                            ),
                            start=int(payload.get("start", 0)),
                            count=int(payload.get("count", 80)),
                            ascending=bool(payload.get("ascending", False)),
                            filter_raw=int(
                                payload.get("filterRaw", payload.get("filter_raw", 0))
                            ),
                        )
                    )
                return
            if parsed.path == "/api/trades":
                with self.server.lock:
                    self._ok(
                        self.server.bridge.trades(
                            payload.get("code", ""),
                            start=int(payload.get("start", 0)),
                            count=int(payload.get("count", 1800)),
                            trading_date=payload.get("date") or None,
                        )
                    )
                return
            if parsed.path == "/api/auctions":
                with self.server.lock:
                    self._ok(
                        self.server.bridge.auctions(
                            payload.get("code", ""),
                            trading_date=payload.get("date") or None,
                            selector=int(payload.get("selector", 3)),
                            start=int(payload.get("start", 0)),
                            limit=int(payload.get("limit", 500)),
                        )
                    )
                return
            if parsed.path == "/api/money_flow":
                with self.server.lock:
                    self._ok(self.server.bridge.money_flow(payload.get("code", "")))
                return
            if parsed.path == "/api/f10_catalog":
                with self.server.lock:
                    self._ok(self.server.bridge.f10_catalog(payload.get("code", "")))
                return
            if parsed.path == "/api/f10_content":
                with self.server.lock:
                    self._ok(
                        self.server.bridge.f10_content(
                            payload.get("code", ""),
                            payload.get("filename", ""),
                            int(payload.get("start", 0)),
                            int(payload.get("length", 0)),
                        )
                    )
                return
            if parsed.path == "/api/stats_summary":
                with self.server.lock:
                    self._ok(self.server.bridge.tdx_stats())
                return
            if parsed.path == "/api/stats_export":
                with self.server.lock:
                    self._ok(self.server.bridge.tdx_stats_export())
                return
            if parsed.path == "/api/stats_query":
                with self.server.lock:
                    self._ok(
                        self.server.bridge.stats_query(
                            str(payload.get("sql") or ""),
                            int(payload.get("limit", 200)),
                        )
                    )
                return
            if parsed.path == "/api/blocks":
                with self.server.lock:
                    self._ok(self.server.bridge.blocks(payload.get("kind", "gn")))
                return
            if parsed.path == "/api/industries":
                with self.server.lock:
                    self._ok(self.server.bridge.industries())
                return
            if parsed.path == "/api/screen":
                nested = payload.get("filters")
                filters = nested if isinstance(nested, dict) else payload
                with self.server.lock:
                    self._ok(self.server.bridge.screen(filters))
                return
            self._error(HTTPStatus.NOT_FOUND, f"未知路径：{parsed.path}")
        except (TdxError, ValueError, TypeError) as error:
            self._error(HTTPStatus.BAD_REQUEST, str(error))
        except Exception as error:  # noqa: BLE001 - 服务端要给出可读错误
            self._error(HTTPStatus.INTERNAL_SERVER_ERROR, str(error))


def create_server(
    host: str = "127.0.0.1",
    port: int = 8765,
    bridge: Bridge | None = None,
    web_dir: str | Path | None = None,
) -> TdxApiServer:
    return TdxApiServer((host, port), bridge or Bridge(), web_dir)


def main() -> None:
    parser = argparse.ArgumentParser(description="StockLens 只读 HTTP 行情 API")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--web-dir", default=None, help="可选：托管 out/web 静态产物")
    args = parser.parse_args()
    server = create_server(args.host, args.port, web_dir=args.web_dir)
    print(f"[api] listening on http://{args.host}:{server.server_port}", file=sys.stderr)
    if server.web_dir is not None:
        print(f"[api] serving web from {server.web_dir}", file=sys.stderr)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        server.bridge.close()


if __name__ == "__main__":
    main()
