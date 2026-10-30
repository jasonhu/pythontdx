"""MAC（0x1c 帧头）行情最小客户端。

只实现 A 股批量报价：三步握手 + 0x122B + 字段位 0~7。
用途是 7709 报价失败时的同一数据源兜底，不替代 K 线/F10 通道。
"""
from __future__ import annotations

import json
import socket
import struct
import time
import zlib

MAC_HOSTS = ("121.36.248.138", "123.60.47.136", "121.37.207.165")
MAC_PORT = 7709
FRAME_HEADER = 16
SETUP_COMMANDS = (
    bytes.fromhex("0c0218930001030003000d0001"),
    bytes.fromhex("0c0218940001030003000d0002"),
    bytes.fromhex("0c031899000120002000db0fd5d0c9ccd6a4a8af0000008fc22540130000d500c9ccbdf0d7ea00000002"),
)
MARKET_IDS = {0: ("SZ", "sz"), 1: ("SH", "sh"), 2: ("BJ", "bj")}
INT_FIELDS = {5, 0x18, 0x19, 0x5D, 0x5E, 0x86, 0x87, 0x88, 0x89, 0x8A, 0x8B}
FIELD_BITS = (
    0,
    1,
    2,
    3,
    4,
    5,
    6,
    7,
    0x11,
    0x12,
    0x18,
    0x19,
    0x48,
    0x49,
    0x5D,
    0x5E,
    0x80,
    0x81,
    0x82,
    0x83,
    0x84,
    0x85,
    0x86,
    0x87,
    0x88,
    0x89,
    0x8A,
    0x8B,
)
# 位 -> (方向, 档位, 是数量)
DEPTH_FIELDS = {
    0x11: ("bid", 1, False),
    0x12: ("ask", 1, False),
    0x18: ("bid", 1, True),
    0x19: ("ask", 1, True),
    0x48: ("bid", 2, False),
    0x49: ("ask", 2, False),
    0x5D: ("bid", 2, True),
    0x5E: ("ask", 2, True),
    0x80: ("bid", 3, False),
    0x81: ("bid", 4, False),
    0x82: ("bid", 5, False),
    0x83: ("ask", 3, False),
    0x84: ("ask", 4, False),
    0x85: ("ask", 5, False),
    0x86: ("bid", 3, True),
    0x87: ("bid", 4, True),
    0x88: ("bid", 5, True),
    0x89: ("ask", 3, True),
    0x8A: ("ask", 4, True),
    0x8B: ("ask", 5, True),
}



class MacError(RuntimeError):
    """MAC 连接或解析失败。"""


def _recv_exact(sock: socket.socket, size: int) -> bytes:
    buffer = bytearray()
    while len(buffer) < size:
        chunk = sock.recv(size - len(buffer))
        if not chunk:
            raise MacError("MAC 连接被关闭")
        buffer.extend(chunk)
    return bytes(buffer)


def _read_response(sock: socket.socket) -> bytes:
    header = _recv_exact(sock, FRAME_HEADER)
    _magic, _seq, _method, zipsize, unzipsize = struct.unpack("<IIIHH", header)
    if zipsize > 4 * 1024 * 1024:
        raise MacError("MAC 响应过大")
    raw = _recv_exact(sock, zipsize)
    if zipsize == unzipsize:
        return raw
    try:
        body = zlib.decompress(raw)
    except zlib.error as error:
        raise MacError(f"MAC 响应解压失败：{error}") from error
    if len(body) != unzipsize:
        raise MacError("MAC 响应长度不符")
    return body


def _handshake(sock: socket.socket) -> None:
    for command in SETUP_COMMANDS:
        sock.sendall(command)
        # 有的主机握手不回包；超时就继续下一条。
        old_timeout = sock.gettimeout()
        sock.settimeout(0.8)
        try:
            _read_response(sock)
        except (socket.timeout, OSError, MacError):
            pass
        finally:
            sock.settimeout(old_timeout)


def _request_quotes(sock: socket.socket, stocks: list[tuple[int, str]]) -> bytes:
    bitmap = bytearray(20)
    for bit in FIELD_BITS:
        bitmap[bit // 8] |= 1 << (bit % 8)
    inner = bytearray(struct.pack("<H", 0x122B))
    inner += bitmap
    inner += struct.pack("<H", len(stocks))
    for market, code in stocks:
        inner += struct.pack("<H22s", market, code.encode("gbk"))
    header = struct.pack("<BIBHH", 0x1C, 0, 1, len(inner), len(inner))
    sock.sendall(header + inner)
    return _read_response(sock)


def parse_quotes(body: bytes, received_at: int) -> list[dict]:
    """解析 0x122B 响应；只信任响应位图中的 0~7 字段。"""
    if len(body) < 26:
        raise MacError("MAC 报价响应过短")
    bitmap = body[:20]
    total, rows = struct.unpack_from("<IH", body, 20)
    if rows > 500 or total > 500:
        raise MacError("MAC 报价行数异常")
    slots = [bit for bit in range(160) if bitmap[bit // 8] >> (bit % 8) & 1]
    row_size = 68 + len(slots) * 4
    position = 26
    quotes: list[dict] = []
    for _ in range(rows):
        if position + row_size > len(body):
            break
        row = body[position : position + row_size]
        position += row_size
        market_id, = struct.unpack_from("<H", row, 0)
        market = MARKET_IDS.get(market_id)
        if market is None:
            continue
        symbol = row[2:24].decode("gbk", errors="ignore").rstrip("\x00")
        name = row[24:68].decode("gbk", errors="ignore").rstrip("\x00")
        if len(symbol) != 6 or not symbol.isdigit():
            continue
        values: dict[int, float] = {}
        for slot, bit in enumerate(slots):
            fmt = "<I" if bit in INT_FIELDS else "<f"
            values[bit] = struct.unpack_from(fmt, row, 68 + slot * 4)[0]
        pre_close = round(float(values.get(0, 0)), 2)
        price = round(float(values.get(4, 0)), 2)
        if price <= 0:
            price = pre_close
        change = round(price - pre_close, 2)
        depth: dict[str, dict[int, dict[str, float]]] = {"bid": {}, "ask": {}}
        for bit, (side, level, is_volume) in DEPTH_FIELDS.items():
            if bit not in values:
                continue
            slot = depth[side].setdefault(level, {"price": 0.0, "volume": 0})
            if is_volume:
                slot["volume"] = int(values[bit])
            else:
                slot["price"] = round(float(values[bit]), 2)
        quotes.append(
            {
                "code": f"{market[1]}{symbol}",
                "symbol": symbol,
                "name": name,
                "market": market[0],
                "price": price,
                "prevClose": pre_close,
                "open": round(float(values.get(1, 0)), 2),
                "high": round(float(values.get(2, 0)), 2),
                "low": round(float(values.get(3, 0)), 2),
                "change": change,
                "changePct": round(change / pre_close * 100, 2) if pre_close else 0.0,
                "volume": int(values.get(5, 0)),
                "amount": float(values.get(7, 0)),
                "volumeRatio": float(values.get(6, 0)),
                "currency": "CNY",
                "time": received_at,
                "receivedAt": received_at,
                "bids": [
                    depth["bid"][level]
                    for level in sorted(depth["bid"])
                    if depth["bid"][level]["price"] > 0
                ],
                "asks": [
                    depth["ask"][level]
                    for level in sorted(depth["ask"])
                    if depth["ask"][level]["price"] > 0
                ],
            }
        )
    return quotes


def fetch_quotes(codes: list[str], timeout: float = 4.0, hosts: tuple[str, ...] = MAC_HOSTS) -> list[dict]:
    """按沪深北代码批量取报价；任一主机成功即返回。"""
    stocks: list[tuple[int, str]] = []
    for code in codes:
        text = code.strip().lower()
        prefix, symbol = text[:2], text[2:]
        if len(symbol) != 6 or not symbol.isdigit():
            continue
        market = {"sh": 1, "sz": 0, "bj": 2}.get(prefix)
        if market is None:
            continue
        stocks.append((market, symbol))
    if not stocks:
        return []
    last_error: Exception | None = None
    for host in hosts:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(timeout)
        try:
            sock.connect((host, MAC_PORT))
            _handshake(sock)
            received_at = int(time.time() * 1000)
            quotes: list[dict] = []
            for start in range(0, len(stocks), 50):
                body = _request_quotes(sock, stocks[start : start + 50])
                quotes.extend(parse_quotes(body, received_at))
            if quotes:
                return quotes
            last_error = MacError("MAC 主机返回空报价")
        except (OSError, MacError) as error:
            last_error = error
        finally:
            sock.close()
    raise MacError(f"MAC 行情不可用：{last_error}")


def _request_capital_flow(sock: socket.socket, market: int, symbol: str) -> bytes:
    body = struct.pack("<H8s16x21s", market, symbol.encode("gbk"), b"Stock_ZJLX")
    inner = struct.pack("<H", 0x1218) + body
    header = struct.pack("<BIBHH", 2, 0, 1, len(inner), len(inner))
    sock.sendall(header + inner)
    return _read_response(sock)


def parse_capital_flow(body: bytes) -> dict:
    """解析 0x1218；服务端正文是 GBK JSON 两行数组。"""
    if len(body) < 27:
        raise MacError("MAC 资金流响应过短")
    try:
        data = json.loads(body[27:].decode("gbk", errors="ignore"))
    except json.JSONDecodeError as error:
        raise MacError(f"MAC 资金流 JSON 解析失败：{error}") from error
    if not isinstance(data, list) or len(data) < 2:
        raise MacError("MAC 资金流字段不足")
    today = data[0] if isinstance(data[0], list) else []
    five = data[1] if isinstance(data[1], list) else []

    def value(seq: list, index: int) -> float:
        try:
            return float(seq[index])
        except (IndexError, TypeError, ValueError):
            return 0.0

    return {
        "mainIn": value(today, 0),
        "mainOut": value(today, 1),
        "mainNet": value(today, 0) - value(today, 1),
        "retailIn": value(today, 2),
        "retailOut": value(today, 3),
        "retailNet": value(today, 2) - value(today, 3),
        "largeNet5d": value(five, 3),
        "midNet5d": value(five, 4),
        "receivedAt": int(time.time() * 1000),
    }


def fetch_capital_flow(code: str, timeout: float = 4.0, hosts: tuple[str, ...] = MAC_HOSTS) -> dict:
    text = code.strip().lower()
    prefix, symbol = text[:2], text[2:]
    market = {"sh": 1, "sz": 0, "bj": 2}.get(prefix)
    if market is None or len(symbol) != 6 or not symbol.isdigit():
        raise MacError("MAC 资金流只支持 A 股代码")
    last_error: Exception | None = None
    for host in hosts:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(timeout)
        try:
            sock.connect((host, MAC_PORT))
            _handshake(sock)
            return parse_capital_flow(_request_capital_flow(sock, market, symbol))
        except (OSError, MacError) as error:
            last_error = error
        finally:
            sock.close()
    raise MacError(f"MAC 资金流不可用：{last_error}")
