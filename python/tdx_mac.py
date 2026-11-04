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
from concurrent.futures import ThreadPoolExecutor

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
    0x1B,
    0x20,
    0x21,
    0x25,
    0x30,
    0x31,
    0x38,
    0x39,
    0x48,
    0x49,
    0x5D,
    0x5E,
    0x69,
    0x73,
    0x74,
    0x75,
    0x76,
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
                "turnoverRate": float(values.get(0x1B, 0)),
                "riseSpeed": float(values.get(0x25, 0)),
                "limitUp": round(float(values.get(0x20, 0)), 2),
                "limitDown": round(float(values.get(0x21, 0)), 2),
                "peTtm": float(values.get(0x30, 0)),
                "peStatic": float(values.get(0x31, 0)),
                "mainNetAmount": float(values.get(0x38, 0)),
                "bidAskRatio": float(values.get(0x39, 0)),
                "shortTurnoverRate": float(values.get(0x69, 0)),
                "ddx": float(values.get(0x73, 0)),
                "ddy": float(values.get(0x74, 0)),
                "ddz": float(values.get(0x75, 0)),
                "ddf": float(values.get(0x76, 0)),
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


def _request_transactions(
    sock: socket.socket, market: int, symbol: str, ymd: int, start: int, count: int
) -> bytes:
    """0x122F：带真实秒字段的 MAC 成交明细，单页最多 1000 条。"""
    body = struct.pack(
        "<H22sIIH10x", market, symbol.encode("gbk"), ymd, start, count
    )
    inner = struct.pack("<H", 0x122F) + body
    header = struct.pack("<BIBHH", 0x1C, 0, 1, len(inner), len(inner))
    sock.sendall(header + inner)
    return _read_response(sock)


def parse_transactions(body: bytes, start: int = 0) -> list[dict]:
    """解析 0x122F；记录起点 39，单条 18 字节，时间是真秒。"""
    if len(body) < 31:
        raise MacError("MAC 成交明细响应过短")
    count = struct.unpack_from("<H", body, 29)[0]
    if count > 2000 or len(body) < 39 + count * 18:
        raise MacError("MAC 成交明细长度异常")
    ticks: list[dict] = []
    for index in range(count):
        offset = 39 + index * 18
        seconds, price, volume, trade_count, status = struct.unpack_from(
            "<IfIIH", body, offset
        )
        if seconds >= 24 * 3600:
            continue
        hour, remainder = divmod(seconds, 3600)
        minute, second = divmod(remainder, 60)
        ticks.append(
            {
                "index": start + index,
                "timeSeconds": seconds,
                "timeMinutes": seconds // 60,
                "time": f"{hour:02d}:{minute:02d}:{second:02d}",
                "price": round(float(price), 3),
                "volume": int(volume),
                "orderCount": int(trade_count),
                "status": int(status),
                "side": _side(status),
                "eventKind": "auction_snapshot"
                if status == 8
                else "opening_match"
                if (hour, minute) == (9, 25)
                else "trade",
                "tradeAmount": round(float(price) * int(volume) * 100, 2)
                if status != 8
                else None,
                "source": "mac-0x122f",
            }
        )
    return ticks


def _side(status: int) -> str:
    return {0: "buy", 1: "sell", 2: "neutral"}.get(status, f"status_{status}")


def fetch_transactions(
    code: str,
    trading_date: str | None = None,
    start: int = 0,
    count: int = 1000,
    timeout: float = 4.0,
    hosts: tuple[str, ...] = MAC_HOSTS,
) -> list[dict]:
    """MAC 0x122F 秒级成交明细；历史日期传 YYYYMMDD 或 YYYY-MM-DD。"""
    text = code.strip().lower()
    prefix, symbol = text[:2], text[2:]
    market = {"sh": 1, "sz": 0, "bj": 2}.get(prefix)
    if market is None or len(symbol) != 6 or not symbol.isdigit():
        raise MacError("MAC 成交明细代码不合法")
    ymd = 0
    if trading_date:
        raw = trading_date.strip().replace("-", "")
        if len(raw) != 8 or not raw.isdigit():
            raise MacError("MAC 成交日期必须是 YYYY-MM-DD 或 YYYYMMDD")
        ymd = int(raw)
    if count < 1 or count > 1000 or start < 0:
        raise MacError("MAC 成交明细分页参数不合法")
    last_error: Exception | None = None
    for host in hosts:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(timeout)
        try:
            sock.connect((host, MAC_PORT))
            _handshake(sock)
            body = _request_transactions(sock, market, symbol, ymd, start, count)
            return parse_transactions(body, start)
        except (OSError, MacError) as error:
            last_error = error
        finally:
            sock.close()
    raise MacError(f"MAC 成交易不可用：{last_error}")


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


def fetch_capital_flows(
    codes: list[str],
    workers: int = 12,
    timeout: float = 4.0,
    hosts: tuple[str, ...] = MAC_HOSTS,
) -> list[dict]:
    """批量取 MAC 0x1218 资金流，用于全市场资金流排行。

    每只股票一条独立连接，并发受 ``workers`` 限制；单只失败只跳过该只，
    不让一个停牌/退市代码拖垮整张榜。返回顺序不保证，调用方按 code 合并。
    """
    if workers < 1 or workers > 24:
        raise MacError("MAC 资金流并发数必须在 1~24 之间")
    unique: list[str] = []
    seen: set[str] = set()
    for raw in codes:
        code = str(raw).strip().lower()
        if not code or code in seen:
            continue
        prefix, symbol = code[:2], code[2:]
        if prefix not in {"sh", "sz", "bj"} or len(symbol) != 6 or not symbol.isdigit():
            continue
        seen.add(code)
        unique.append(code)
    if not unique:
        return []

    def one(code: str) -> dict | None:
        try:
            flow = fetch_capital_flow(code, timeout=timeout, hosts=hosts)
        except (OSError, MacError):
            return None
        return {"code": code, **flow}

    with ThreadPoolExecutor(max_workers=min(workers, len(unique))) as executor:
        rows = list(executor.map(one, unique))
    return [row for row in rows if row is not None]


def _describe_unusual(kind: int, data: bytes) -> tuple[str, str]:
    if len(data) < 13:
        return "", ""
    v1, v2, v3, v4 = struct.unpack_from("<B2fI", data)
    if kind == 0x03:
        return f"主力{'买入' if v1 == 0 else '卖出'}", f"{v2:.2f}/{v3:.2f}"
    if kind == 0x04:
        return "加速拉升", f"{v2 * 100:.2f}%"
    if kind == 0x05:
        return "加速下跌", ""
    if kind == 0x06:
        return "低位反弹", f"{v2 * 100:.2f}%"
    if kind == 0x07:
        return "高位回落", f"{v2 * 100:.2f}%"
    if kind == 0x08:
        return "撑杆跳高", f"{v2 * 100:.2f}%"
    if kind == 0x09:
        return "平台跳水", f"{v2 * 100:.2f}%"
    if kind == 0x0A:
        return f"单笔冲{'跌' if v2 < 0 else '涨'}", f"{v2 * 100:.2f}%"
    if kind == 0x0B:
        direction = "平" if v3 == 0 else "跌" if v3 < 0 else "涨"
        suffix = "" if v3 == 0 else f"{v3 * 100:.2f}%"
        return f"区间放量{direction}", f"{v2:.1f}倍{suffix}"
    if kind == 0x0C:
        return "区间缩量", ""
    if kind == 0x10:
        return "大单托盘", f"{v4:.2f}/{v3:.2f}"
    if kind == 0x11:
        return "大单压盘", f"{v2:.2f}/{v3:.2f}"
    if kind == 0x12:
        return "大单锁盘", ""
    if kind == 0x13:
        return "竞价试买", f"{v2:.2f}/{v3:.2f}"
    if kind == 0x14:
        direction = "涨" if v1 == 0 else "跌"
        sub_type, v2_alt, v3_alt = struct.unpack_from("<Bff", data, 1)
        if sub_type == 0x01:
            return f"逼近{direction}停", f"{v2_alt:.2f}/{v3_alt:.2f}"
        if sub_type == 0x02:
            return f"封{direction}停板", f"{v2_alt:.2f}/{v3_alt:.2f}"
        if sub_type == 0x04:
            return f"封{direction}大减", f"{v2_alt:.2f}/{v3_alt:.2f}"
        if sub_type == 0x05:
            return f"打开{direction}停", f"{v2_alt:.2f}/{v3_alt:.2f}"
        return f"涨跌停({direction})", f"{v2_alt:.2f}/{v3_alt:.2f}"
    return f"异动{kind:#04x}", ""


def _request_unusual(sock: socket.socket, market: int, count: int) -> bytes:
    body = struct.pack("<HH2xH2xH5H", market, 0, min(count, 600), 1, 200, 30, 40, 50, 200)
    inner = struct.pack("<H", 0x1237) + body
    header = struct.pack("<BIBHH", 0x1C, 0, 1, len(inner), len(inner))
    sock.sendall(header + inner)
    return _read_response(sock)


def parse_unusual(body: bytes) -> list[dict]:
    if len(body) < 2:
        raise MacError("MAC 异动响应过短")
    count = struct.unpack_from("<H", body, 0)[0]
    if count > 600 or len(body) < 2 + count * 32:
        raise MacError("MAC 异动行数异常")
    names = body[2 + count * 32 :].decode("gbk", errors="ignore").strip(",").split(",")
    items: list[dict] = []
    for index in range(count):
        offset = 2 + index * 32
        market_id, raw_code, _z0, kind, _z1, sort_index, _z2 = struct.unpack_from(
            "<H6sBBBHH", body, offset
        )
        market = MARKET_IDS.get(market_id)
        if market is None:
            continue
        symbol = raw_code.decode("gbk", errors="ignore").rstrip("\x00")
        if len(symbol) != 6 or not symbol.isdigit():
            continue
        desc, value = _describe_unusual(kind, body[offset + 15 : offset + 28])
        hour, minute_second = struct.unpack_from("<BH", body, offset + 29)
        items.append(
            {
                "market": market[0],
                "code": f"{market[1]}{symbol}",
                "symbol": symbol,
                "name": names[index] if index < len(names) else "",
                "time": f"{hour:02d}:{minute_second // 100:02d}:{minute_second % 100:02d}",
                "desc": desc,
                "value": value,
                "type": kind,
                "index": sort_index,
            }
        )
    return items


def fetch_unusual(market: int, count: int = 600, timeout: float = 4.0, hosts: tuple[str, ...] = MAC_HOSTS) -> list[dict]:
    last_error: Exception | None = None
    for host in hosts:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(timeout)
        try:
            sock.connect((host, MAC_PORT))
            _handshake(sock)
            return parse_unusual(_request_unusual(sock, market, count))
        except (OSError, MacError) as error:
            last_error = error
        finally:
            sock.close()
    raise MacError(f"MAC 异动不可用：{last_error}")


_BOARD_RECORD = "<H6s16s44sfffH6s16s44sfff"


def _request_boards(sock: socket.socket, board_type: int, start: int, page_size: int) -> bytes:
    body = struct.pack("<HHBBHH8x", page_size, board_type, 0, 0, start, 1)
    inner = struct.pack("<H", 0x1231) + body
    header = struct.pack("<BIBHH", 0x1C, 0, 1, len(inner), len(inner))
    sock.sendall(header + inner)
    return _read_response(sock)


def parse_boards(body: bytes) -> list[dict]:
    if len(body) < 4:
        raise MacError("MAC 板块列表响应过短")
    count_all, _total = struct.unpack_from("<HH", body, 0)
    count = count_all // 2
    if count > 500:
        raise MacError("MAC 板块列表行数异常")
    size = struct.calcsize(_BOARD_RECORD)
    if len(body) < 4 + count * size:
        raise MacError("MAC 板块列表长度不符")
    boards: list[dict] = []
    for index in range(count):
        values = struct.unpack_from(_BOARD_RECORD, body, 4 + index * size)
        (
            market,
            code_raw,
            _pad1,
            name_raw,
            price,
            rise_speed,
            pre_close,
            leader_market,
            leader_code_raw,
            _pad2,
            leader_name_raw,
            leader_price,
            leader_rise_speed,
            leader_pre_close,
        ) = values
        code = code_raw.decode("gbk", errors="ignore").rstrip("\x00")
        if len(code) != 6 or not code.isdigit():
            continue
        boards.append(
            {
                "market": market,
                "code": code,
                "name": name_raw.decode("gbk", errors="ignore").rstrip("\x00"),
                "price": round(price, 3),
                "riseSpeed": round(rise_speed, 3),
                "preClose": round(pre_close, 3),
                "leaderMarket": leader_market,
                "leaderCode": leader_code_raw.decode("gbk", errors="ignore").rstrip("\x00"),
                "leaderName": leader_name_raw.decode("gbk", errors="ignore").rstrip("\x00"),
                "leaderPrice": round(leader_price, 3),
                "leaderRiseSpeed": round(leader_rise_speed, 3),
                "leaderPreClose": round(leader_pre_close, 3),
            }
        )
    return boards


def fetch_boards(board_type: int = 255, timeout: float = 4.0, hosts: tuple[str, ...] = MAC_HOSTS) -> list[dict]:
    last_error: Exception | None = None
    for host in hosts:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(timeout)
        try:
            sock.connect((host, MAC_PORT))
            _handshake(sock)
            boards: list[dict] = []
            start = 0
            while start < 2000:
                chunk = parse_boards(_request_boards(sock, board_type, start, 150))
                if not chunk:
                    break
                boards.extend(chunk)
                start += len(chunk)
                if len(chunk) < 150:
                    break
            for board in boards:
                board["type"] = board_type
            return boards
        except (OSError, MacError) as error:
            last_error = error
        finally:
            sock.close()
    raise MacError(f"MAC 板块列表不可用：{last_error}")
