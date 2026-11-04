#!/usr/bin/env python3
"""pythontdx 的只读 HTTP 行情 API。

为什么还要这一层：
  · Electron 桌面用 stdio sidecar；浏览器/Web 端需要一个普通的 HTTP 入口；
  · 先把「协议 + 解析」复用成 JSON API，Web UI 才能和桌面共用同一套数据语义。

实现刻意只用标准库：ThreadingHTTPServer + json。单用户本地服务，所有 Bridge
调用串行化（TdxConnection 不是线程安全的），默认只绑 127.0.0.1。
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import socket
import struct
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

    def _ws_read(self) -> tuple[int, bytes]:
        header = self.connection.recv(2)
        if len(header) < 2:
            raise ConnectionResetError("websocket closed")
        first, second = header[0], header[1]
        if not (first & 0x80):
            raise ValueError("fragmented frames are not supported")
        opcode = first & 0x0F
        if not (second & 0x80):
            raise ValueError("client frame must be masked")
        length = second & 0x7F
        if length == 126:
            length = struct.unpack(">H", self._recv_exact(2))[0]
        elif length == 127:
            length = struct.unpack(">Q", self._recv_exact(8))[0]
        if length > 1_000_000:
            raise ValueError("websocket frame too large")
        mask = self._recv_exact(4)
        payload = bytearray(self._recv_exact(length))
        for index in range(length):
            payload[index] ^= mask[index % 4]
        return opcode, bytes(payload)

    def _recv_exact(self, count: int) -> bytes:
        data = bytearray()
        while len(data) < count:
            chunk = self.connection.recv(count - len(data))
            if not chunk:
                raise ConnectionResetError("websocket closed")
            data.extend(chunk)
        return bytes(data)

    def _ws_send(self, opcode: int, payload: bytes = b"") -> None:
        header = bytes([0x80 | opcode])
        length = len(payload)
        if length < 126:
            header += bytes([length])
        elif length < 65536:
            header += bytes([126]) + struct.pack(">H", length)
        else:
            header += bytes([127]) + struct.pack(">Q", length)
        self.connection.sendall(header + payload)

    def _websocket(self) -> None:
        key = self.headers.get("Sec-WebSocket-Key", "")
        version = self.headers.get("Sec-WebSocket-Version", "")
        if not key or version != "13":
            self._error(HTTPStatus.BAD_REQUEST, "WebSocket 握手缺少 Key/Version 13")
            return
        accept = base64.b64encode(
            hashlib.sha1((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode()).digest()
        ).decode()
        self.send_response(HTTPStatus.SWITCHING_PROTOCOLS)
        self.send_header("Upgrade", "websocket")
        self.send_header("Connection", "Upgrade")
        self.send_header("Sec-WebSocket-Accept", accept)
        self.end_headers()
        self.close_connection = True
        self.connection.settimeout(0.2)
        codes: list[str] = []
        interval = 3.0
        next_poll = 0.0
        try:
            while True:
                now = time.time()
                if codes and now >= next_poll:
                    try:
                        with self.server.lock:
                            quotes = self.server.bridge.quotes(codes)
                        self._ws_send(
                            1,
                            json.dumps(
                                {
                                    "type": "quote",
                                    "quotes": quotes,
                                    "at": int(time.time() * 1000),
                                },
                                ensure_ascii=False,
                            ).encode(),
                        )
                    except Exception as error:  # noqa: BLE001
                        self._ws_send(
                            1,
                            json.dumps(
                                {"type": "error", "error": str(error)},
                                ensure_ascii=False,
                            ).encode(),
                        )
                    next_poll = time.time() + interval
                try:
                    opcode, payload = self._ws_read()
                except socket.timeout:
                    continue
                except (ConnectionError, ValueError):
                    return
                if opcode == 8:
                    return
                if opcode == 9:
                    self._ws_send(10, payload)
                    continue
                if opcode != 1:
                    continue
                try:
                    message = json.loads(payload.decode("utf-8"))
                except (UnicodeDecodeError, json.JSONDecodeError):
                    self._ws_send(1, b'{"type":"error","error":"invalid json"}')
                    continue
                if not isinstance(message, dict) or message.get("type") != "subscribe":
                    continue
                raw_codes = message.get("codes")
                if not isinstance(raw_codes, list):
                    self._ws_send(1, b'{"type":"error","error":"codes must be an array"}')
                    continue
                codes = [str(code).strip().lower() for code in raw_codes if str(code).strip()][:500]
                try:
                    interval = max(1.0, min(60.0, float(message.get("intervalMs", 3000)) / 1000))
                except (TypeError, ValueError):
                    interval = 3.0
                next_poll = 0.0
                self._ws_send(
                    1,
                    json.dumps({"type": "subscribed", "codes": len(codes)}).encode(),
                )
        finally:
            self.close_connection = True

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
            if parsed.path == "/ws":
                self._websocket()
                return
            if parsed.path == "/api/stream":
                self._stream(query)
                return
            if parsed.path == "/api/ping":
                self._ok("pong")
                return
            if parsed.path == "/api/server_speed_test":
                with self.server.lock:
                    self._ok(self.server.bridge.server_speed_test())
                return
            if parsed.path == "/api/select_server":
                with self.server.lock:
                    self._ok(self.server.bridge.select_server(str(payload.get("host") or "")))
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
                            query.get("adjust", "qfq"),
                            query.get("cacheOnly") in {"1", "true", "yes"},
                            query.get("anchorDate") or None,
                        )
                    )
                return
            if parsed.path == "/api/adjustment_factors":
                with self.server.lock:
                    self._ok(
                        self.server.bridge.adjustment_factors(
                            query.get("code", ""),
                            query.get("anchorDate") or None,
                            query.get("startDate") or None,
                        )
                    )
                return
            if parsed.path == "/api/local_adjust_kline":
                with self.server.lock:
                    self._ok(
                        self.server.bridge.local_adjust_kline(
                            query.get("code", ""),
                            query.get("period", "day"),
                            query.get("adjust", "qfq"),
                            int(query.get("count", "800")),
                        )
                    )
                return
            if parsed.path == "/api/special_limits":
                with self.server.lock:
                    self._ok(
                        self.server.bridge.special_limits(
                            int(query.get("startIndex", "0"))
                        )
                    )
                return
            if parsed.path == "/api/special_limits_scan":
                with self.server.lock:
                    self._ok(
                        self.server.bridge.scan_special_limits(
                            int(query.get("maxRows", "10000"))
                        )
                    )
                return
            if parsed.path == "/api/delisted_kline":
                with self.server.lock:
                    self._ok(
                        self.server.bridge.delisted_kline(
                            query.get("code", ""),
                            int(query.get("start", "0")),
                            int(query.get("count", "800")),
                        )
                    )
                return
            if parsed.path == "/api/delisted_history":
                with self.server.lock:
                    self._ok(
                        self.server.bridge.delisted_history(
                            query.get("code", ""),
                            int(query.get("pageSize", "800")),
                            int(query.get("maxPages", "200")),
                        )
                    )
                return
            if parsed.path == "/api/finance_snapshot":
                codes = [
                    item.strip()
                    for item in query.get("codes", "").split(",")
                    if item.strip()
                ]
                with self.server.lock:
                    self._ok(self.server.bridge.finance_snapshot(codes))
                return
            if parsed.path == "/api/finance_archives":
                with self.server.lock:
                    self._ok(
                        self.server.bridge.finance_archive_list(
                            int(query.get("limit", "50"))
                        )
                    )
                return
            if parsed.path == "/api/capital_changes":
                codes = [
                    item.strip()
                    for item in query.get("codes", "").split(",")
                    if item.strip()
                ]
                with self.server.lock:
                    self._ok(self.server.bridge.capital_changes(codes))
                return
            if parsed.path == "/api/capital_archives":
                with self.server.lock:
                    self._ok(
                        self.server.bridge.capital_archive_list(
                            int(query.get("limit", "50"))
                        )
                    )
                return
            if parsed.path == "/api/block_meta":
                with self.server.lock:
                    self._ok(
                        self.server.bridge.block_meta(query.get("filename", ""))
                    )
                return
            if parsed.path == "/api/block_meta_archives":
                with self.server.lock:
                    self._ok(
                        self.server.bridge.block_meta_archive_list(
                            int(query.get("limit", "50"))
                        )
                    )
                return
            if parsed.path == "/api/special_limits_archives":
                with self.server.lock:
                    self._ok(
                        self.server.bridge.special_limits_archive_list(
                            int(query.get("limit", "50"))
                        )
                    )
                return
            if parsed.path == "/api/delisted_archives":
                with self.server.lock:
                    self._ok(
                        self.server.bridge.delisted_archive_list(
                            int(query.get("limit", "100"))
                        )
                    )
                return
            if parsed.path == "/api/minute":
                with self.server.lock:
                    self._ok(self.server.bridge.minute(query.get("code", "")))
                return
            if parsed.path == "/api/minute_archives":
                with self.server.lock:
                    self._ok(
                        self.server.bridge.minute_archive_list(
                            int(query.get("limit", "50"))
                        )
                    )
                return
            if parsed.path == "/api/minute_aux":
                with self.server.lock:
                    self._ok(
                        self.server.bridge.minute_aux(
                            query.get("code", ""),
                            query.get("kind", "buy_sell_strength"),
                        )
                    )
                return
            if parsed.path == "/api/minute_aux_archives":
                with self.server.lock:
                    self._ok(
                        self.server.bridge.minute_aux_archive_list(
                            int(query.get("limit", "50"))
                        )
                    )
                return
            if parsed.path == "/api/recent_minute":
                with self.server.lock:
                    self._ok(
                        self.server.bridge.recent_minute(
                            query.get("code", ""), query.get("date") or None
                        )
                    )
                return
            if parsed.path == "/api/history_minute":
                with self.server.lock:
                    self._ok(
                        self.server.bridge.history_minute(
                            query.get("code", ""), query.get("date", "")
                        )
                    )
                return
            if parsed.path == "/api/history_minute_archives":
                with self.server.lock:
                    self._ok(
                        self.server.bridge.history_minute_archive_list(
                            int(query.get("limit", "50"))
                        )
                    )
                return
            if parsed.path == "/api/recent_minute_archives":
                with self.server.lock:
                    self._ok(
                        self.server.bridge.recent_minute_archive_list(
                            int(query.get("limit", "50"))
                        )
                    )
                return
            if parsed.path == "/api/sparkline":
                with self.server.lock:
                    self._ok(
                        self.server.bridge.sparkline(
                            query.get("code", ""),
                            int(query.get("selector", "1")),
                            int(query.get("window", "20")),
                        )
                    )
                return
            if parsed.path == "/api/sparkline_archives":
                with self.server.lock:
                    self._ok(
                        self.server.bridge.sparkline_archive_list(
                            int(query.get("limit", "50"))
                        )
                    )
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
            if parsed.path == "/api/category_snapshot":
                with self.server.lock:
                    self._ok(
                        self.server.bridge.category_snapshot(
                            int(payload.get("category", 6)),
                            int(payload.get("sortType", 0)),
                            int(payload.get("maxPages", 100)),
                        )
                    )
                return
            if parsed.path == "/api/category_archive_save":
                with self.server.lock:
                    self._ok(
                        self.server.bridge.category_archive_save(
                            int(payload.get("category", 6)),
                            int(payload.get("sortType", 0)),
                        )
                    )
                return
            if parsed.path == "/api/category_archives":
                with self.server.lock:
                    self._ok(
                        self.server.bridge.category_archive_list(
                            int(payload.get("limit", 50))
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
                            selector=int(payload.get("selector", 0)),
                            start=int(payload.get("start", 0)),
                            limit=int(payload.get("limit", 500)),
                        )
                    )
                return
            if parsed.path == "/api/auction_archive_save":
                with self.server.lock:
                    self._ok(
                        self.server.bridge.auction_archive_save(
                            str(payload.get("code") or ""), payload.get("date") or None
                        )
                    )
                return
            if parsed.path == "/api/auction_archive_read":
                with self.server.lock:
                    self._ok(
                        self.server.bridge.auction_archive_read(
                            str(payload.get("code") or ""),
                            str(payload.get("date") or ""),
                        )
                    )
                return
            if parsed.path == "/api/auction_archive_list":
                with self.server.lock:
                    self._ok(
                        self.server.bridge.auction_archive_list(
                            int(payload.get("limit", 50))
                        )
                    )
                return
            if parsed.path == "/api/auction_archive_batch":
                with self.server.lock:
                    self._ok(
                        self.server.bridge.auction_archive_batch(
                            payload.get("codes") or [], payload.get("date") or None
                        )
                    )
                return
            if parsed.path == "/api/tick_archive_dates":
                with self.server.lock:
                    self._ok(
                        self.server.bridge.tick_archive_dates(
                            str(payload.get("code") or ""),
                            str(payload.get("start") or "") or None,
                            str(payload.get("end") or "") or None,
                            int(payload.get("days", 20)),
                        )
                    )
                return
            if parsed.path == "/api/tick_archive_save":
                with self.server.lock:
                    self._ok(
                        self.server.bridge.tick_archive_save(
                            str(payload.get("code") or ""),
                            str(payload.get("date") or ""),
                        )
                    )
                return
            if parsed.path == "/api/tick_archive_batch":
                with self.server.lock:
                    self._ok(
                        self.server.bridge.tick_archive_batch(
                            payload.get("codes") or [],
                            str(payload.get("date") or ""),
                        )
                    )
                return
            if parsed.path == "/api/tick_archive_list":
                with self.server.lock:
                    self._ok(
                        self.server.bridge.tick_archive_list(int(payload.get("limit", 20)))
                    )
                return
            if parsed.path == "/api/money_flow":
                with self.server.lock:
                    self._ok(self.server.bridge.money_flow(payload.get("code", "")))
                return
            if parsed.path == "/api/f10_pit_list":
                with self.server.lock:
                    from f10_pit import list_f10_snapshots
                    from tdx_bridge import pythontdx_data_dir

                    self._ok(
                        list_f10_snapshots(
                            pythontdx_data_dir() / "lake" / "f10_pit",
                            int(payload.get("limit", 50)),
                        )
                    )
                return
            if parsed.path == "/api/f10_pit_read":
                with self.server.lock:
                    from f10_pit import read_f10_snapshot
                    from tdx_bridge import pythontdx_data_dir

                    self._ok(
                        read_f10_snapshot(
                            pythontdx_data_dir() / "lake" / "f10_pit",
                            str(payload.get("code") or ""),
                            str(payload.get("table") or ""),
                            str(payload.get("date") or ""),
                        )
                    )
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
            if parsed.path == "/api/f10_announcements":
                with self.server.lock:
                    self._ok(self.server.bridge.f10_announcements(payload.get("code", "")))
                return
            if parsed.path == "/api/f10_profile":
                with self.server.lock:
                    self._ok(self.server.bridge.f10_profile(payload.get("code", "")))
                return
            if parsed.path == "/api/f10_valuation":
                with self.server.lock:
                    self._ok(self.server.bridge.f10_valuation(payload.get("code", "")))
                return
            if parsed.path == "/api/f10_finance":
                with self.server.lock:
                    self._ok(self.server.bridge.f10_finance(payload.get("code", "")))
                return
            if parsed.path == "/api/f10_business":
                with self.server.lock:
                    self._ok(self.server.bridge.f10_business(payload.get("code", "")))
                return
            if parsed.path == "/api/f10_shareholders":
                with self.server.lock:
                    self._ok(self.server.bridge.f10_shareholders(payload.get("code", "")))
                return
            if parsed.path == "/api/f10_reports":
                with self.server.lock:
                    self._ok(self.server.bridge.f10_reports(payload.get("code", "")))
                return
            if parsed.path == "/api/f10_news":
                with self.server.lock:
                    self._ok(self.server.bridge.f10_news(payload.get("code", "")))
                return
            if parsed.path == "/api/f10_digest":
                with self.server.lock:
                    self._ok(
                        self.server.bridge.f10_digest(
                            payload.get("code", ""), payload.get("section", "tips")
                        )
                    )
                return
            if parsed.path == "/api/f10_market_news":
                with self.server.lock:
                    self._ok(
                        self.server.bridge.f10_market_news(
                            int(payload.get("tab", 3)),
                            int(payload.get("page", 1)),
                            int(payload.get("pageSize", 50)),
                        )
                    )
                return
            if parsed.path == "/api/f10_channel_news":
                with self.server.lock:
                    self._ok(
                        self.server.bridge.f10_channel_news(
                            int(payload.get("channel", 201)),
                            int(payload.get("page", 1)),
                            int(payload.get("pageSize", 50)),
                            str(payload.get("keyword") or ""),
                        )
                    )
                return
            if parsed.path == "/api/f10_market_news_archive_save":
                with self.server.lock:
                    self._ok(
                        self.server.bridge.f10_market_news_archive_save(
                            int(payload.get("tab", 3)),
                            int(payload.get("page", 1)),
                            int(payload.get("pageSize", 50)),
                        )
                    )
                return
            if parsed.path == "/api/f10_market_news_archives":
                with self.server.lock:
                    self._ok(
                        self.server.bridge.f10_market_news_archive_list(
                            int(payload.get("limit", 50))
                        )
                    )
                return
            if parsed.path == "/api/f10_market_report":
                with self.server.lock:
                    self._ok(
                        self.server.bridge.f10_market_report(
                            str(payload.get("code") or ""),
                            str(payload.get("section") or "board_info"),
                            str(payload.get("arg") or ""),
                            int(payload.get("page", 1)),
                            int(payload.get("pageSize", 20)),
                        )
                    )
                return
            if parsed.path == "/api/f10_profit_forecast":
                with self.server.lock:
                    self._ok(
                        self.server.bridge.f10_profit_forecast(
                            payload.get("code", ""), payload.get("section", "ylyctj")
                        )
                    )
                return
            if parsed.path == "/api/f10_governance":
                with self.server.lock:
                    self._ok(
                        self.server.bridge.f10_governance(
                            payload.get("code", ""), payload.get("section", "gljy")
                        )
                    )
                return
            if parsed.path == "/api/f10_hot_topics":
                with self.server.lock:
                    self._ok(
                        self.server.bridge.f10_hot_topics(
                            payload.get("code", ""), payload.get("section", "zttzbkz")
                        )
                    )
                return
            if parsed.path == "/api/f10_fund_report":
                with self.server.lock:
                    self._ok(
                        self.server.bridge.f10_fund_report(
                            str(payload.get("code") or ""),
                            str(payload.get("section") or "basic"),
                            str(payload.get("arg") or ""),
                            str(payload.get("date") or ""),
                            int(payload.get("page", 1)),
                            int(payload.get("pageSize", 20)),
                        )
                    )
                return
            if parsed.path == "/api/f10_detail_archive_save":
                with self.server.lock:
                    self._ok(
                        self.server.bridge.f10_detail_archive_save(
                            str(payload.get("detailType") or ""),
                            str(payload.get("recordId") or ""),
                        )
                    )
                return
            if parsed.path == "/api/f10_detail_archives":
                with self.server.lock:
                    self._ok(
                        self.server.bridge.f10_detail_archive_list(
                            int(payload.get("limit", 50))
                        )
                    )
                return
            if parsed.path == "/api/f10_detail":
                with self.server.lock:
                    self._ok(
                        self.server.bridge.f10_detail(
                            str(payload.get("detailType") or ""),
                            str(payload.get("recordId") or ""),
                        )
                    )
                return
            if parsed.path == "/api/f10_ranking_detail":
                with self.server.lock:
                    self._ok(
                        self.server.bridge.f10_ranking_detail(
                            payload.get("code", ""), payload.get("section", "scpmdela")
                        )
                    )
                return
            if parsed.path == "/api/f10_northbound_holding":
                with self.server.lock:
                    self._ok(
                        self.server.bridge.f10_northbound_holding(
                            payload.get("code", ""),
                            payload.get("section", "bszj"),
                            int(payload.get("page", 1)),
                            int(payload.get("pageSize", 20)),
                        )
                    )
                return
            if parsed.path == "/api/f10_industry":
                with self.server.lock:
                    self._ok(
                        self.server.bridge.f10_industry(
                            payload.get("code", ""), payload.get("section", "summary")
                        )
                    )
                return
            if parsed.path == "/api/mac_boards":
                with self.server.lock:
                    self._ok(self.server.bridge.mac_boards(int(payload.get("boardType", 255))))
                return
            if parsed.path == "/api/mac_unusual":
                with self.server.lock:
                    self._ok(self.server.bridge.mac_unusual(int(payload.get("count", 600))))
                return
            if parsed.path == "/api/mac_money_flow":
                with self.server.lock:
                    self._ok(self.server.bridge.mac_money_flow(str(payload.get("code") or "")))
                return
            if parsed.path == "/api/mac_money_flow_batch":
                with self.server.lock:
                    self._ok(
                        self.server.bridge.mac_money_flow_batch(
                            payload.get("codes") or [], int(payload.get("workers", 12))
                        )
                    )
                return
            if parsed.path == "/api/mac_quotes":
                with self.server.lock:
                    self._ok(self.server.bridge.mac_quotes(payload.get("codes") or []))
                return
            if parsed.path == "/api/mac_quotes_finance":
                with self.server.lock:
                    self._ok(
                        self.server.bridge.mac_quotes_finance(payload.get("codes") or [])
                    )
                return
            if parsed.path == "/api/lake_archives":
                with self.server.lock:
                    self._ok(self.server.bridge.lake_archives(int(payload.get("limit", 20))))
                return
            if parsed.path == "/api/finance_archive_save":
                with self.server.lock:
                    self._ok(
                        self.server.bridge.finance_archive_save(
                            list(payload.get("codes") or [])
                        )
                    )
                return
            if parsed.path == "/api/capital_archive_save":
                with self.server.lock:
                    self._ok(
                        self.server.bridge.capital_archive_save(
                            list(payload.get("codes") or [])
                        )
                    )
                return
            if parsed.path == "/api/block_meta_archive_save":
                with self.server.lock:
                    self._ok(
                        self.server.bridge.block_meta_archive_save(
                            str(payload.get("filename") or "")
                        )
                    )
                return
            if parsed.path == "/api/minute_archive_save":
                with self.server.lock:
                    self._ok(
                        self.server.bridge.minute_archive_save(
                            str(payload.get("code") or "")
                        )
                    )
                return
            if parsed.path == "/api/minute_aux_archive_save":
                with self.server.lock:
                    self._ok(
                        self.server.bridge.minute_aux_archive_save(
                            str(payload.get("code") or ""),
                            str(payload.get("kind") or "buy_sell_strength"),
                        )
                    )
                return
            if parsed.path == "/api/recent_minute_archive_save":
                with self.server.lock:
                    self._ok(
                        self.server.bridge.recent_minute_archive_save(
                            str(payload.get("code") or ""),
                            payload.get("date") or None,
                        )
                    )
                return
            if parsed.path == "/api/history_minute_archive_save":
                with self.server.lock:
                    self._ok(
                        self.server.bridge.history_minute_archive_save(
                            str(payload.get("code") or ""),
                            str(payload.get("date") or ""),
                        )
                    )
                return
            if parsed.path == "/api/sparkline_archive_save":
                with self.server.lock:
                    self._ok(
                        self.server.bridge.sparkline_archive_save(
                            str(payload.get("code") or ""),
                            int(payload.get("selector", 1)),
                            int(payload.get("window", 20)),
                        )
                    )
                return
            if parsed.path == "/api/special_limits_archive_save":
                with self.server.lock:
                    self._ok(
                        self.server.bridge.special_limits_archive_save(
                            int(payload.get("maxRows", 10000))
                        )
                    )
                return
            if parsed.path == "/api/delisted_archive_save":
                with self.server.lock:
                    self._ok(
                        self.server.bridge.delisted_archive_save(
                            str(payload.get("code") or ""),
                            int(payload.get("pageSize", 800)),
                            int(payload.get("maxPages", 200)),
                        )
                    )
                return
            if parsed.path == "/api/archive_snapshot":
                with self.server.lock:
                    self._ok(self.server.bridge.archive_snapshot())
                return
            if parsed.path == "/api/export_klines":
                with self.server.lock:
                    self._ok(
                        self.server.bridge.export_klines(
                            payload.get("codes") or [],
                            str(payload.get("period") or "day"),
                            int(payload.get("count", 240)),
                            str(payload.get("adjust") or "qfq"),
                        )
                    )
                return
            if parsed.path == "/api/data_integrity":
                with self.server.lock:
                    self._ok(self.server.bridge.data_integrity())
                return
            if parsed.path == "/api/data_coverage":
                with self.server.lock:
                    self._ok(self.server.bridge.data_coverage())
                return
            if parsed.path == "/api/data_inventory":
                with self.server.lock:
                    self._ok(self.server.bridge.data_inventory())
                return
            if parsed.path == "/api/flow_archive_list":
                with self.server.lock:
                    from flow_archive import list_flow_archives
                    from tdx_bridge import pythontdx_data_dir

                    self._ok(
                        list_flow_archives(
                            pythontdx_data_dir() / "lake" / "money_flow",
                            int(payload.get("limit", 50)),
                        )
                    )
                return
            if parsed.path == "/api/flow_archive_read":
                with self.server.lock:
                    from flow_archive import read_flow_archive
                    from tdx_bridge import pythontdx_data_dir

                    self._ok(
                        read_flow_archive(
                            pythontdx_data_dir() / "lake" / "money_flow",
                            str(payload.get("code") or ""),
                            str(payload.get("date") or ""),
                        )
                    )
                return
            if parsed.path == "/api/server_catalog":
                with self.server.lock:
                    self._ok(self.server.bridge.server_catalog())
                return
            if parsed.path == "/api/server_catalog_list":
                with self.server.lock:
                    self._ok(
                        self.server.bridge.server_catalog_list(int(payload.get("limit", 20)))
                    )
                return
            if parsed.path == "/api/cache_klines":
                with self.server.lock:
                    self._ok(
                        self.server.bridge.cache_klines(
                            list(payload.get("codes") or []),
                            str(payload.get("period") or "day"),
                            int(payload.get("count") or 800),
                            str(payload.get("adjust") or "qfq"),
                        )
                    )
                return

            if parsed.path == "/api/cache_full_klines":
                with self.server.lock:
                    self._ok(
                        self.server.bridge.cache_full_klines(
                            list(payload.get("codes") or []),
                            str(payload.get("period") or "day"),
                            str(payload.get("adjust") or "none"),
                            bool(payload.get("skipExisting")),
                        )
                    )
                return

            if parsed.path == "/api/chart_patterns":
                with self.server.lock:
                    self._ok(
                        self.server.bridge.chart_patterns(
                            str(payload.get("code") or ""),
                            str(payload.get("period", "day")),
                            str(payload.get("adjust", "qfq")),
                            int(payload.get("lookback", 160)),
                        )
                    )
                return
            if parsed.path == "/api/limit_review":
                with self.server.lock:
                    self._ok(self.server.bridge.limit_review(str(payload.get("date") or "")))
                return

            if parsed.path == "/api/local_write_min":
                with self.server.lock:
                    self._ok(
                        self.server.bridge.local_min_write(
                            str(payload.get("path") or ""), payload.get("bars") or []
                        )
                    )
                return
            if parsed.path == "/api/local_write":
                with self.server.lock:
                    self._ok(
                        self.server.bridge.local_day_write(
                            str(payload.get("path") or ""), payload.get("bars") or []
                        )
                    )
                return
            if parsed.path == "/api/local_query":
                with self.server.lock:
                    self._ok(
                        self.server.bridge.run_local_query(
                            str(payload.get("sql") or ""), int(payload.get("limit", 200))
                        )
                    )
                return
            if parsed.path == "/api/local_import":
                with self.server.lock:
                    self._ok(
                        self.server.bridge.local_import(str(payload.get("path") or ""))
                    )
                return
            if parsed.path == "/api/local_day":
                with self.server.lock:
                    self._ok(
                        self.server.bridge.local_day_read(
                            str(payload.get("path") or ""), int(payload.get("limit", 0))
                        )
                    )
                return
            if parsed.path == "/api/market_breadth":
                with self.server.lock:
                    self._ok(self.server.bridge.market_breadth())
                return
            if parsed.path == "/api/f10_change_plans":
                with self.server.lock:
                    self._ok(self.server.bridge.f10_change_plans(str(payload.get("code") or "")))
                return
            if parsed.path == "/api/f10_controller":
                with self.server.lock:
                    self._ok(self.server.bridge.f10_controller(str(payload.get("code") or "")))
                return
            if parsed.path == "/api/f10_institutions":
                with self.server.lock:
                    self._ok(self.server.bridge.f10_institutions(str(payload.get("code") or "")))
                return
            if parsed.path == "/api/f10_shareholder_changes":
                with self.server.lock:
                    self._ok(self.server.bridge.f10_shareholder_changes(str(payload.get("code") or "")))
                return
            if parsed.path == "/api/f10_circulating_shareholders":
                with self.server.lock:
                    self._ok(
                        self.server.bridge.f10_circulating_shareholders(str(payload.get("code") or ""))
                    )
                return
            if parsed.path == "/api/f10_capital":
                with self.server.lock:
                    self._ok(
                        self.server.bridge.f10_capital(
                            str(payload.get("code") or ""), str(payload.get("section") or "structure")
                        )
                    )
                return
            if parsed.path == "/api/f10_shareholder_count":
                with self.server.lock:
                    self._ok(self.server.bridge.f10_shareholder_count(str(payload.get("code") or "")))
                return
            if parsed.path == "/api/f10_dividend":
                with self.server.lock:
                    self._ok(self.server.bridge.f10_dividend(str(payload.get("code") or "")))
                return
            if parsed.path == "/api/f10_market":
                with self.server.lock:
                    self._ok(self.server.bridge.f10_market(str(payload.get("section") or "basic")))
                return
            if parsed.path == "/api/f10_lhb_market":
                with self.server.lock:
                    self._ok(self.server.bridge.f10_lhb_market())
                return
            if parsed.path == "/api/f10_trading":
                with self.server.lock:
                    self._ok(
                        self.server.bridge.f10_trading(
                            payload.get("code", ""), str(payload.get("section", "margin"))
                        )
                    )
                return
            if parsed.path == "/api/f10_statement":
                with self.server.lock:
                    self._ok(
                        self.server.bridge.f10_statement(
                            payload.get("code", ""),
                            str(payload.get("kind", "zcfzb")),
                            bool(payload.get("full", False)),
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
            if parsed.path == "/api/stats_csv":
                with self.server.lock:
                    self._ok(self.server.bridge.stats_csv())
                return
            if parsed.path == "/api/stats_parquet":
                with self.server.lock:
                    self._ok(self.server.bridge.stats_parquet())
                return
            if parsed.path == "/api/formula_backtest":
                with self.server.lock:
                    self._ok(
                        self.server.bridge.formula_backtest(
                            str(payload.get("expression") or ""),
                            int(payload.get("scope", 100)),
                            int(payload.get("offset", 0)),
                            int(payload.get("batchSize", 100)),
                        )
                    )
                return
            if parsed.path == "/api/formula_screen":
                with self.server.lock:
                    self._ok(
                        self.server.bridge.formula_screen(
                            str(payload.get("expression") or ""),
                            int(payload.get("scope", 100)),
                            int(payload.get("limit", 100)),
                            int(payload.get("offset", 0)),
                            int(payload.get("batchSize", 100)),
                        )
                    )
                return
            if parsed.path == "/api/duck_query":
                with self.server.lock:
                    self._ok(
                        self.server.bridge.stats_duck_query(
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
    parser = argparse.ArgumentParser(description="pythontdx 只读 HTTP 行情 API")
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
