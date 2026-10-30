#!/usr/bin/env python3
"""
StockLens 的通达信行情桥接进程。

职责：
  · 持有 7709 TCP 连接，完成握手、请求、超时、重连、主站 failover；
  · 解析五档行情 / K 线 / 分时 / 历史分时 / 代码表 / 财务；
  · 支持 0x053e 旧版五档、0x054c 批量快照、0x0547 增量刷新（五档基线）；
  · 用 JSON Lines 与 Electron 主进程通信（stdin 收命令，stdout 回结果）。

为什么是 sidecar 而不是把协议写在 Node 里：
  · 用户希望通讯用 Python；
  · 这个文件只依赖标准库，PyInstaller 可以打成单文件，
    不需要在用户机器上安装 Python，也不需要 pytdx/eltdx。

协议要点（2026-10 实测）：
  · 握手只能发一条 0x000d；pytdx 的 setup1/2/3 三连包会让服务端进入旧版会话，
    之后 0x053e 只回 4 字节空包；
  · 0x053e 单次最多 80 只；0x052d 单页最多 800 根；
  · 0x052d 的 adjust=1 是服务端前复权；
  · 指数的五档字段是垃圾值，K 线记录还要多读 4 字节；
  · 7709 没有港股/美股。

手工调试：
  echo '{"id":1,"cmd":"ping"}' | python3 python/tdx_bridge.py
  echo '{"id":2,"cmd":"quotes","payload":{"codes":["sh600519"]}}' | python3 python/tdx_bridge.py
"""

from __future__ import annotations

import json
import re
import socket
import struct
import sys
import time
import traceback
import zlib

# ---------------------------------------------------------------- 常量

ENDPOINTS = [
    ("124.71.187.122", 7709),
    ("180.153.18.170", 7709),
    ("116.205.183.150", 7709),
    ("111.230.186.52", 7709),
    ("119.97.185.59", 7709),
]

CONNECT_TIMEOUT = 5.0
REQUEST_TIMEOUT = 8.0
QUOTE_BATCH = 80
FINANCE_BATCH = 80
CODE_PAGE = 1600
FINANCE_TTL = 6 * 60 * 60

CMD_HANDSHAKE = 0x000D
CMD_HEARTBEAT = 0x0004
CMD_QUOTES = 0x053E
CMD_SNAPSHOT = 0x054C
CMD_REFRESH = 0x0547
CMD_CATEGORY = 0x054B
CMD_TODAY_TICKS = 0x0FC5
CMD_HISTORY_TICKS = 0x0FC6
CMD_BARS = 0x052D
CMD_MINUTE = 0x0537
CMD_HISTORY_MINUTE = 0x0FB4
CMD_SECURITY_COUNT = 0x044E
CMD_SECURITY_LIST = 0x044D
CMD_FINANCE = 0x0010

# 0x054c / 0x053e 共用的请求前缀；0x0547 是另一套「代码 + 游标」布局
QUOTE_LIST_PREFIX = b"\x05\x00\x00\x00\x00\x00\x00\x00"
REFRESH_BATCH = 100
TRADE_PAGE = 1800

MARKET_NAMES = {0: "SZ", 1: "SH", 2: "BJ"}
MARKET_IDS = {"sz": 0, "sh": 1, "bj": 2}
PERIOD_RAW = {"day": 4, "week": 5, "month": 6}


class TdxError(Exception):
    """message 直接是能展示给用户的中文"""


# ---------------------------------------------------------------- 编解码


def encode_frame(msg_id: int, msg_type: int, data: bytes) -> bytes:
    length = len(data) + 2

    if length > 0xFFFF:
        raise TdxError("行情请求过大")

    return struct.pack("<BIBHHH", 0x0C, msg_id, 0x01, length, length, msg_type) + data


def read_varint(buf: bytes, pos: int) -> tuple[int, int]:
    if pos < 0 or pos >= len(buf):
        raise TdxError("行情报文不完整")

    byte = buf[pos]
    value = byte & 0x3F
    negative = bool(byte & 0x40)
    shift = 6
    cursor = pos + 1

    while byte & 0x80:
        if cursor >= len(buf):
            raise TdxError("行情报文不完整")
        byte = buf[cursor]
        value += (byte & 0x7F) << shift
        shift += 7
        cursor += 1
        if shift > 49:
            raise TdxError("行情报文数值溢出")

    return (-value if negative else value), cursor


def decode_volume(raw: int) -> float:
    """通达信的压缩浮点：最高字节是指数，低 3 字节是尾数。"""
    if raw == 0:
        return 0.0

    signed = raw - 0x100000000 if raw >= 0x80000000 else raw
    logpoint = signed >> 24
    hleax = (signed >> 16) & 0xFF
    lheax = (signed >> 8) & 0xFF
    lleax = signed & 0xFF

    base = 2.0 ** (logpoint * 2 - 0x7F)
    high = base * (64 + (hleax & 0x7F)) / 64 if hleax > 0x80 else base * hleax / 128
    scale = 2.0 if hleax & 0x80 else 1.0
    middle = base * lheax / 32768 * scale
    low = base * lleax / 8388608 * scale

    return base + high + middle + low


def _u16(buf: bytes, pos: int) -> int:
    if pos + 2 > len(buf):
        raise TdxError("行情报文不完整")
    return struct.unpack_from("<H", buf, pos)[0]


def _u32(buf: bytes, pos: int) -> int:
    if pos + 4 > len(buf):
        raise TdxError("行情报文不完整")
    return struct.unpack_from("<I", buf, pos)[0]


def _f32(buf: bytes, pos: int) -> float:
    if pos + 4 > len(buf):
        raise TdxError("行情报文不完整")
    return struct.unpack_from("<f", buf, pos)[0]


def price_divisor(decimal: int | None) -> int:
    if decimal is None or decimal <= 2:
        return 1
    if decimal == 3:
        return 10
    return 10 ** (decimal - 2)


def is_index_code(market: int, symbol: str) -> bool:
    if market == 1:
        return symbol.startswith("000") or symbol.startswith("999")
    if market == 0:
        return symbol.startswith("399")
    return symbol.startswith("899")


def normalize_name(name: str) -> str:
    """腾讯/通达信都会用空格做视觉对齐：'五 粮 液' → '五粮液'。

    但英文名里的空格有意义（如 'INTL GENIUS'），只压成一个空格。
    """
    text = name.strip()
    if not text:
        return ""
    if re.search(r"[A-Za-z]", text):
        return re.sub(r"\s+", " ", text)
    return re.sub(r"\s+", "", text)


def classify_security(market: int, symbol: str) -> str:
    if is_index_code(market, symbol):
        return "ZS"
    if symbol.startswith(("11", "12")):
        return "ZQ"
    if symbol.startswith(("15", "16", "18", "50", "51", "52", "56", "58")):
        return "JJ"
    if symbol.startswith(("200", "900")):
        return "GP-B"
    return "GP-A"


# ---------------------------------------------------------------- 连接


class TdxConnection:
    def __init__(self, endpoints: list[tuple[str, int]] | None = None):
        self.endpoints = list(endpoints or ENDPOINTS)
        self.sock: socket.socket | None = None
        self.msg_id = 0
        self.cursor = 0

    def close(self) -> None:
        if self.sock is not None:
            try:
                self.sock.close()
            except OSError:
                pass
            self.sock = None

    def _connect(self) -> None:
        last_error: Exception | None = None

        for attempt in range(len(self.endpoints)):
            index = (self.cursor + attempt) % len(self.endpoints)
            host, port = self.endpoints[index]
            sock: socket.socket | None = None
            try:
                sock = socket.create_connection((host, port), timeout=CONNECT_TIMEOUT)
                sock.settimeout(REQUEST_TIMEOUT)
                sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
                self.sock = sock
                # 只发 0x000d；不要 setup2/setup3
                self._transact(CMD_HANDSHAKE, b"\x01")
                self.cursor = index
                return
            except Exception as error:  # noqa: BLE001 - 主站失败要继续试下一个
                last_error = error
                if sock is not None:
                    try:
                        sock.close()
                    except OSError:
                        pass
                self.sock = None

        raise TdxError("行情服务器连接失败，请检查网络") from last_error

    def _recv_exact(self, size: int) -> bytes:
        if self.sock is None:
            raise TdxError("行情服务器未连接")

        chunks: list[bytes] = []
        remaining = size
        while remaining > 0:
            data = self.sock.recv(remaining)
            if not data:
                raise TdxError("行情服务器连接已断开")
            chunks.append(data)
            remaining -= len(data)
        return b"".join(chunks)

    def _transact(self, msg_type: int, data: bytes) -> bytes:
        if self.sock is None:
            raise TdxError("行情服务器未连接")

        self.msg_id = (self.msg_id + 1) & 0xFFFFFFFF
        if self.msg_id == 0:
            self.msg_id = 1

        self.sock.sendall(encode_frame(self.msg_id, msg_type, data))
        header = self._recv_exact(16)
        if header[:4] != b"\xb1\xcbt\x00":
            raise TdxError("行情报文头不合法")

        zip_length, length = struct.unpack_from("<HH", header, 12)
        raw = self._recv_exact(zip_length) if zip_length > 0 else b""
        if zip_length == length:
            return raw

        try:
            return zlib.decompress(raw)
        except zlib.error as error:
            raise TdxError("行情报文解压失败") from error

    def request(self, msg_type: int, data: bytes, retry: bool = True) -> bytes:
        try:
            if self.sock is None:
                self._connect()
            return self._transact(msg_type, data)
        except (OSError, TdxError) as error:
            self.close()
            if not retry:
                raise
            # 断线重连一次；行情请求都是只读的，重试不会产生副作用
            self._connect()
            return self._transact(msg_type, data)


# ---------------------------------------------------------------- 请求体


def code_bytes(symbol: str) -> bytes:
    if len(symbol) != 6 or not symbol.isdigit():
        raise TdxError(f"证券代码不是 6 位数字：{symbol}")
    return symbol.encode("ascii")


def quote_data(items: list[tuple[int, str]]) -> bytes:
    if not items:
        raise TdxError("行情请求不能为空")
    if len(items) > QUOTE_BATCH:
        raise TdxError("单次行情请求不能超过 80 只")

    payload = bytearray(QUOTE_LIST_PREFIX)
    payload += struct.pack("<H", len(items))
    for market, symbol in items:
        payload += struct.pack("<B", market) + code_bytes(symbol)
    return bytes(payload)


def refresh_data(
    items: list[tuple[int, str]], cursors: dict[str, int] | None = None
) -> bytes:
    """0x0547：每个代码 11 字节（市场 1 + 代码 6 + 游标 4），单次最多 100 只。"""
    if not items:
        raise TdxError("行情刷新请求不能为空")
    if len(items) > REFRESH_BATCH:
        raise TdxError("单次增量刷新不能超过 100 只")

    payload = bytearray(struct.pack("<H", len(items)))
    for market, symbol in items:
        code = full_code(market, symbol)
        cursor = int((cursors or {}).get(code, 0))
        payload += struct.pack("<B", market) + code_bytes(symbol)
        payload += struct.pack("<I", max(0, min(cursor, 0xFFFFFFFF)))
    return bytes(payload)


def category_data(
    category: int = 6,
    sort_type: int = 0,
    start: int = 0,
    count: int = 80,
    ascending: bool = False,
    filter_raw: int = 0,
) -> bytes:
    """0x054b：9 个 u16，服务端排序；category=6 是沪深 A 股。"""
    if category < 0 or category > 0xFFFF or sort_type < 0 or sort_type > 0xFFFF:
        raise TdxError("分类行情参数超出 u16 范围")
    if start < 0 or start > 0xFFFF or count < 1 or count > 80:
        raise TdxError("分类行情必须满足 0 <= start <= 65535、1 <= count <= 80")
    if filter_raw < 0 or filter_raw > 0xFFFF:
        raise TdxError("分类行情过滤值超出 u16 范围")

    values = [
        category,
        sort_type,
        start,
        count,
        2 if ascending else 1,
        5,
        filter_raw,
        1,
        0,
    ]
    return b"".join(struct.pack("<H", value) for value in values)


def trades_data(
    market: int,
    symbol: str,
    start: int = 0,
    count: int = TRADE_PAGE,
    trading_date: str | None = None,
) -> bytes:
    """0x0fc5 当日 / 0x0fc6 历史成交明细；单页上限 1800。"""
    if start < 0 or start > 0xFFFF:
        raise TdxError("成交明细起点超出 u16 范围")
    if count < 1 or count > TRADE_PAGE:
        raise TdxError("单页成交明细必须在 1~1800 条之间")

    if trading_date is None:
        return struct.pack(
            "<BB6sHH", market, 0, code_bytes(symbol), start, count
        )

    raw_date = trading_date.strip().replace("-", "")
    if len(raw_date) != 8 or not raw_date.isdigit():
        raise TdxError("历史成交日期必须是 YYYY-MM-DD 或 YYYYMMDD")
    return struct.pack(
        "<IH6sHH", int(raw_date), market, code_bytes(symbol), start, count
    )


def bars_data(market: int, symbol: str, period: int, count: int, adjust: int, start: int = 0) -> bytes:
    if count < 1 or count > 800:
        raise TdxError("单次 K 线请求必须在 1~800 根之间")

    return struct.pack(
        "<H6sHHHHHI20s",
        market,
        code_bytes(symbol),
        period,
        1,
        start,
        count,
        adjust,
        0,
        b"",
    )


def minute_data(market: int, symbol: str) -> bytes:
    return struct.pack("<H6s4s", market, code_bytes(symbol), b"\x00\x00\x00\x93")


def history_minute_data(market: int, symbol: str, date: int) -> bytes:
    return struct.pack("<IB6s", date, market, code_bytes(symbol))


def count_data(market: int, client_date: int) -> bytes:
    return struct.pack("<HI", market, client_date)


def list_data(market: int, start: int, limit: int) -> bytes:
    return struct.pack("<HII4s", market, start, limit, b"")


def finance_data(items: list[tuple[int, str]]) -> bytes:
    if not items:
        raise TdxError("财务请求不能为空")
    if len(items) > FINANCE_BATCH:
        raise TdxError("单次财务请求不能超过 80 只")

    payload = bytearray(struct.pack("<H", len(items)))
    for market, symbol in items:
        payload += struct.pack("<B", market) + code_bytes(symbol)
    return bytes(payload)


# ---------------------------------------------------------------- 解析


def parse_code(code: str) -> tuple[int, str]:
    """'sh600519' → (1, '600519')；港股/美股/非法代码直接抛错。"""
    text = code.strip().lower()
    if len(text) < 3:
        raise TdxError("证券代码格式不正确")
    prefix = text[:2]
    symbol = text[2:]
    market = MARKET_IDS.get(prefix)
    if market is None or len(symbol) != 6 or not symbol.isdigit():
        raise TdxError("当前数据源暂不支持港股/美股")
    return market, symbol


def full_code(market: int, symbol: str) -> str:
    return f"{MARKET_NAMES[market].lower()}{symbol}"


def parse_quotes(
    body: bytes, received_at: int, securities: dict[str, dict]
) -> list[dict]:
    count = _u16(body, 2)
    if count == 0:
        return []
    if len(body) < 4 + count * 52:
        raise TdxError("行情报文不完整")

    pos = 4
    quotes: list[dict] = []

    for index in range(count):
        if pos + 9 > len(body):
            raise TdxError("行情报文不完整")

        market_id = body[pos]
        market = MARKET_NAMES.get(market_id)
        if market is None:
            raise TdxError("行情报文包含未知市场")

        symbol = body[pos + 1 : pos + 7].decode("ascii", errors="strict").rstrip("\x00")
        if len(symbol) != 6 or not symbol.isdigit():
            raise TdxError("行情报文包含非法代码")
        pos += 9

        def read() -> int:
            nonlocal pos
            value, pos = read_varint(body, pos)
            return value

        close_raw = read()
        last_close_diff = read()
        open_diff = read()
        high_diff = read()
        low_diff = read()
        read()  # 行情时间原始值：语义未确认，先按接收时间展示
        read()  # 时间后的未知字段
        total_hand = read()
        read()  # 现手
        amount_raw = _u32(body, pos)
        pos += 4
        read()  # 内盘
        read()  # 外盘
        read()  # 外盘后的未知字段
        read()  # 开盘金额

        bid_levels: list[tuple[int, int]] = []
        ask_levels: list[tuple[int, int]] = []
        for _ in range(5):
            bid_delta = read()
            ask_delta = read()
            bid_volume = read()
            ask_volume = read()
            bid_levels.append((close_raw + bid_delta, bid_volume))
            ask_levels.append((close_raw + ask_delta, ask_volume))

        _u16(body, pos)  # trading status
        pos += 2
        for _ in range(4):
            read()

        if index == count - 1:
            if len(body) - pos == 4:
                pos += 4
            elif len(body) != pos:
                raise TdxError("行情报文尾部长度异常")
        elif not is_record_start(body, pos):
            if pos + 4 > len(body):
                raise TdxError("行情报文不完整")
            pos += 4

        key = full_code(market_id, symbol)
        security = securities.get(key, {})
        divisor = price_divisor(security.get("decimal"))
        scale = 100 * divisor
        index_code = is_index_code(market_id, symbol)

        prev_close = (close_raw + last_close_diff) / scale
        price = close_raw / scale
        if price <= 0:
            price = prev_close

        open_price = (close_raw + open_diff) / scale
        high = (close_raw + high_diff) / scale
        low = (close_raw + low_diff) / scale
        amount = decode_volume(amount_raw)
        change = price - prev_close if prev_close > 0 else 0.0

        quote: dict = {
            "code": key,
            "symbol": symbol,
            "name": security.get("name") or symbol,
            "market": market,
            "price": price,
            "prevClose": prev_close,
            "open": open_price,
            "high": high,
            "low": low,
            "change": change,
            "changePct": (change / prev_close * 100) if prev_close > 0 else 0.0,
            "volume": total_hand,
            "amount": amount,
            "currency": "CNY",
            "time": received_at,
            "receivedAt": received_at,
            "bids": [] if index_code else to_levels(bid_levels, scale),
            "asks": [] if index_code else to_levels(ask_levels, scale),
        }

        if prev_close > 0:
            quote["amplitude"] = (high - low) / prev_close * 100
        if not index_code and total_hand > 0 and amount > 0:
            quote["avgPrice"] = amount / (total_hand * 100)

        quotes.append(quote)

    return quotes


def _split_quote_records(data: bytes, items: list[tuple[int, str]]) -> list[bytes]:
    """按「市场 + 6 位代码」标记切记录；记录长度可变，不能按固定长度切。"""
    if not items:
        return []
    if len(items) == 1:
        return [data]

    starts: list[int] = []
    search_from = 0
    for market, symbol in items:
        marker = struct.pack("<B", market) + code_bytes(symbol)
        position = data.find(marker, search_from)
        if position < 0:
            raise TdxError("行情记录缺少代码标记")
        starts.append(position)
        search_from = position + len(marker)

    return [data[start : (starts[index + 1] if index + 1 < len(starts) else len(data))]
            for index, start in enumerate(starts)]


def _read_k_prices(record: bytes, pos: int) -> tuple[tuple[int, int, int, int, int], int]:
    """五个差分价格，统一换成 milli（1/1000 元）。"""
    current_delta, pos = read_varint(record, pos)
    last_close_delta, pos = read_varint(record, pos)
    open_delta, pos = read_varint(record, pos)
    high_delta, pos = read_varint(record, pos)
    low_delta, pos = read_varint(record, pos)
    current_milli = current_delta * 10
    return (
        (
            current_milli,
            (current_delta + last_close_delta) * 10,
            (current_delta + open_delta) * 10,
            (current_delta + high_delta) * 10,
            (current_delta + low_delta) * 10,
        ),
        pos,
    )


def _build_quote(
    market_id: int,
    symbol: str,
    received_at: int,
    securities: dict[str, dict],
    prices: tuple[int, int, int, int, int],
    total_hand: int,
    amount_raw: int,
    bid_levels: list[tuple[int, int]],
    ask_levels: list[tuple[int, int]],
) -> dict:
    current_milli, prev_milli, open_milli, high_milli, low_milli = prices
    market = MARKET_NAMES[market_id]
    key = full_code(market_id, symbol)
    security = securities.get(key, {})
    divisor = price_divisor(security.get("decimal"))
    scale = 1000 * divisor
    index_code = is_index_code(market_id, symbol)

    prev_close = prev_milli / scale
    price = current_milli / scale
    if price <= 0:
        price = prev_close
    open_price = open_milli / scale
    high = high_milli / scale
    low = low_milli / scale
    amount = decode_volume(amount_raw)
    change = price - prev_close if prev_close > 0 else 0.0

    def levels(raw_levels: list[tuple[int, int]]) -> list[dict]:
        if index_code:
            return []
        return [
            {"price": raw_price / scale, "volume": volume}
            for raw_price, volume in raw_levels
            if raw_price > 0
        ]

    quote: dict = {
        "code": key,
        "symbol": symbol,
        "name": security.get("name") or symbol,
        "market": market,
        "price": price,
        "prevClose": prev_close,
        "open": open_price,
        "high": high,
        "low": low,
        "change": change,
        "changePct": (change / prev_close * 100) if prev_close > 0 else 0.0,
        "volume": total_hand,
        "amount": amount,
        "currency": "CNY",
        "time": received_at,
        "receivedAt": received_at,
        "bids": levels(bid_levels),
        "asks": levels(ask_levels),
    }
    if prev_close > 0:
        quote["amplitude"] = (high - low) / prev_close * 100
    if not index_code and total_hand > 0 and amount > 0:
        quote["avgPrice"] = amount / (total_hand * 100)
    return quote


def _parse_snapshot_record(
    record: bytes,
    market_id: int,
    symbol: str,
    received_at: int,
    securities: dict[str, dict],
) -> dict:
    if len(record) < 9:
        raise TdxError("0x054c 记录不完整")
    prices, pos = _read_k_prices(record, 9)
    _time_raw, pos = read_varint(record, pos)
    _unknown_time, pos = read_varint(record, pos)
    total_hand, pos = read_varint(record, pos)
    _current_hand, pos = read_varint(record, pos)
    amount_raw = _u32(record, pos)
    pos += 4
    _inside, pos = read_varint(record, pos)
    _outside, pos = read_varint(record, pos)
    _unknown_outer, pos = read_varint(record, pos)
    _open_amount, pos = read_varint(record, pos)
    bid_delta, pos = read_varint(record, pos)
    ask_delta, pos = read_varint(record, pos)
    bid_volume, pos = read_varint(record, pos)
    ask_volume, pos = read_varint(record, pos)

    current_milli = prices[0]
    bid_milli = current_milli + bid_delta * 10
    ask_milli = current_milli + ask_delta * 10
    return _build_quote(
        market_id,
        symbol,
        received_at,
        securities,
        prices,
        total_hand,
        amount_raw,
        [(bid_milli, bid_volume)],
        [(ask_milli, ask_volume)],
    )


def parse_snapshots(
    body: bytes,
    items: list[tuple[int, str]],
    received_at: int,
    securities: dict[str, dict],
) -> list[dict]:
    """0x054c：批量快照，盘口只稳定返回买一/卖一。"""
    if len(body) < 4:
        raise TdxError("0x054c 报文不完整")
    count = _u16(body, 2)
    if count == 0:
        return []
    if count > len(items):
        raise TdxError("0x054c 返回数量超过请求数量")

    records = _split_quote_records(body[4:], items[:count])
    quotes: list[dict] = []
    for (market, symbol), record in zip(items[:count], records):
        quotes.append(
            _parse_snapshot_record(record, market, symbol, received_at, securities)
        )
    return quotes


def _parse_refresh_record(
    record: bytes,
    market_id: int,
    symbol: str,
    received_at: int,
    securities: dict[str, dict],
) -> dict:
    if len(record) < 9:
        raise TdxError("0x0547 记录不完整")
    prices, pos = _read_k_prices(record, 9)
    _update_time = _u32(record, pos)
    pos += 4
    _status, pos = read_varint(record, pos)
    total_hand, pos = read_varint(record, pos)
    _current_hand, pos = read_varint(record, pos)
    amount_raw = _u32(record, pos)
    pos += 4
    _inside, pos = read_varint(record, pos)
    _outside, pos = read_varint(record, pos)
    _unknown_outer, pos = read_varint(record, pos)
    _open_amount, pos = read_varint(record, pos)

    current_milli = prices[0]
    bid_levels: list[tuple[int, int]] = []
    ask_levels: list[tuple[int, int]] = []
    for _ in range(5):
        bid_delta, pos = read_varint(record, pos)
        ask_delta, pos = read_varint(record, pos)
        bid_volume, pos = read_varint(record, pos)
        ask_volume, pos = read_varint(record, pos)
        bid_levels.append((current_milli + bid_delta * 10, bid_volume))
        ask_levels.append((current_milli + ask_delta * 10, ask_volume))

    return _build_quote(
        market_id,
        symbol,
        received_at,
        securities,
        prices,
        total_hand,
        amount_raw,
        bid_levels,
        ask_levels,
    )


def parse_refresh(
    body: bytes,
    items: list[tuple[int, str]],
    received_at: int,
    securities: dict[str, dict],
) -> list[dict]:
    """0x0547：增量刷新页，payload 每字节 XOR 0x93，首次游标 0 给出五档基线。"""
    decoded = bytes(byte ^ 0x93 for byte in body)
    if len(decoded) < 2:
        raise TdxError("0x0547 报文不完整")
    count = _u16(decoded, 0)
    if count == 0:
        return []
    if count > len(items):
        raise TdxError("0x0547 返回数量超过请求数量")

    records = _split_quote_records(decoded[2:], items[:count])
    quotes: list[dict] = []
    for (market, symbol), record in zip(items[:count], records):
        quotes.append(
            _parse_refresh_record(record, market, symbol, received_at, securities)
        )
    return quotes


def _parse_category_record(
    body: bytes,
    offset: int,
    received_at: int,
    securities: dict[str, dict],
) -> tuple[dict, int]:
    if offset + 9 > len(body):
        raise TdxError("0x054b 记录头不完整")
    market_id = body[offset]
    market = MARKET_NAMES.get(market_id)
    if market is None:
        raise TdxError("0x054b 包含未知市场")
    symbol = body[offset + 1 : offset + 7].decode("ascii", errors="strict")
    if len(symbol) != 6 or not symbol.isdigit():
        raise TdxError("0x054b 包含非法代码")
    pos = offset + 9
    prices, pos = _read_k_prices(body, pos)

    _server_time, pos = read_varint(body, pos)
    _neg_price, pos = read_varint(body, pos)
    total_hand, pos = read_varint(body, pos)
    _current_hand, pos = read_varint(body, pos)
    amount_raw = _u32(body, pos)
    pos += 4
    _inside, pos = read_varint(body, pos)
    _outside, pos = read_varint(body, pos)
    _after_outer, pos = read_varint(body, pos)
    _open_amount, pos = read_varint(body, pos)
    bid_delta, pos = read_varint(body, pos)
    ask_delta, pos = read_varint(body, pos)
    bid_volume, pos = read_varint(body, pos)
    ask_volume, pos = read_varint(body, pos)

    tail_start = pos
    if tail_start + 56 > len(body):
        raise TdxError("0x054b 记录尾部不完整")
    status_raw = struct.unpack_from("<H", body, tail_start)[0]
    rise_speed_raw = struct.unpack_from("<h", body, tail_start + 2)[0]
    short_turnover_raw = struct.unpack_from("<h", body, tail_start + 4)[0]
    min2_amount = _f32(body, tail_start + 6)
    opening_rush_raw = struct.unpack_from("<h", body, tail_start + 10)[0]
    vol_rise_speed = _f32(body, tail_start + 22)
    depth = _f32(body, tail_start + 26)
    active2 = struct.unpack_from("<H", body, tail_start + 54)[0]
    pos = tail_start + 56

    current_milli = prices[0]
    bid_milli = current_milli + bid_delta * 10
    ask_milli = current_milli + ask_delta * 10
    quote = _build_quote(
        market_id,
        symbol,
        received_at,
        securities,
        prices,
        total_hand,
        amount_raw,
        [(bid_milli, bid_volume)],
        [(ask_milli, ask_volume)],
    )
    quote["active2"] = active2
    quote["statusRaw"] = status_raw
    quote["riseSpeed"] = rise_speed_raw / 100
    quote["shortTurnover"] = short_turnover_raw / 100
    quote["min2Amount"] = min2_amount
    quote["openingRush"] = opening_rush_raw / 100
    quote["volRiseSpeed"] = vol_rise_speed
    quote["depth"] = depth
    if quote["bids"]:
        quote["lockedAmount"] = quote["bids"][0]["price"] * bid_volume * 100
    return quote, pos


def parse_category_quotes(
    body: bytes, received_at: int, securities: dict[str, dict]
) -> list[dict]:
    """0x054b：服务端排序的一页分类行情（A 股 category=6）。"""
    if len(body) < 4:
        raise TdxError("0x054b 报文不完整")
    count = _u16(body, 2)
    if count == 0:
        return []
    if len(body) < 4 + count * 86:
        raise TdxError("0x054b 记录数量与报文长度不符")

    quotes: list[dict] = []
    offset = 4
    for _ in range(count):
        quote, offset = _parse_category_record(
            body, offset, received_at, securities
        )
        quotes.append(quote)
    return quotes


def _trade_side(status: int) -> str:
    return {0: "buy", 1: "sell", 2: "neutral"}.get(status, f"status_{status}")


def parse_trades(
    body: bytes,
    market: int,
    symbol: str,
    start: int,
    securities: dict[str, dict],
    trading_date: str | None = None,
) -> list[dict]:
    """0x0fc5（当日）/ 0x0fc6（历史）成交明细。

    价格是差分累计值；A 股 /100，可转债 /1000。status=8 是竞价快照，不是成交。
    """
    if len(body) < 2:
        raise TdxError("成交明细报文不完整")
    count = _u16(body, 0)
    pos = 2
    if trading_date is not None:
        if len(body) < 6:
            raise TdxError("历史成交明细缺少价格基数")
        pos = 6  # 2 字节价格基数 f32，解析价格不需要它
    if count == 0:
        return []
    if count > (len(body) - pos) // 7:
        raise TdxError("成交明细数量与报文长度不符")

    security = securities.get(full_code(market, symbol), {})
    convertible = security.get("kind") == "ZQ" or symbol.startswith(("11", "12"))
    price_scale = 1000.0 if convertible else 100.0
    price_acc = 0
    ticks: list[dict] = []

    for index in range(count):
        time_minutes = _u16(body, pos)
        pos += 2
        price_delta, pos = read_varint(body, pos)
        volume, pos = read_varint(body, pos)
        order_count, pos = read_varint(body, pos)
        status, pos = read_varint(body, pos)
        tail, pos = read_varint(body, pos)

        price_acc += price_delta
        price = price_acc / price_scale
        event_kind = (
            "auction_snapshot"
            if status == 8
            else "opening_match"
            if time_minutes == 9 * 60 + 25
            else "trade"
        )
        tick: dict = {
            "index": start + index,
            "timeMinutes": time_minutes,
            "time": f"{time_minutes // 60:02d}:{time_minutes % 60:02d}",
            "price": price,
            "volume": volume,
            "orderCount": order_count,
            "status": status,
            "side": _trade_side(status),
            "eventKind": event_kind,
            "tailRaw": tail,
        }
        if event_kind != "auction_snapshot" and price > 0 and volume > 0:
            tick["tradeAmount"] = price * volume * 100
        ticks.append(tick)

    return ticks


def is_record_start(buf: bytes, pos: int) -> bool:
    if pos + 7 > len(buf):
        return False
    if buf[pos] > 2:
        return False
    return all(0x30 <= byte <= 0x39 for byte in buf[pos + 1 : pos + 7])


def to_levels(levels: list[tuple[int, int]], scale: int) -> list[dict]:
    result = []
    for raw_price, volume in levels:
        price = raw_price / scale
        if price > 0:
            result.append({"price": price, "volume": volume})
    return result


def parse_bars(body: bytes, kind: str) -> list[dict]:
    count = _u16(body, 0)
    if len(body) < 2 + count * 16:
        raise TdxError("K 线报文不完整")

    pos = 2
    base = 0
    bars: list[dict] = []

    for _ in range(count):
        date_raw = _u32(body, pos)
        pos += 4

        open_diff, pos = read_varint(body, pos)
        close_diff, pos = read_varint(body, pos)
        high_diff, pos = read_varint(body, pos)
        low_diff, pos = read_varint(body, pos)

        open_raw = base + open_diff
        close_raw = open_raw + close_diff
        volume_raw = _u32(body, pos)
        _u32(body, pos + 4)  # amount
        pos += 8
        if kind == "index":
            pos += 4

        volume = decode_volume(volume_raw)
        bars.append(
            {
                "date": format_date(date_raw),
                "open": open_raw / 1000,
                "close": close_raw / 1000,
                "high": (open_raw + high_diff) / 1000,
                "low": (open_raw + low_diff) / 1000,
                "volume": volume / 100,
            }
        )
        base = close_raw

    return bars


def format_date(raw: int) -> str:
    year, month, day = raw // 10000, raw % 10000 // 100, raw % 100
    if year < 1990 or year > 2100 or month < 1 or month > 12 or day < 1 or day > 31:
        raise TdxError("K 线日期不合法")
    return f"{year:04d}-{month:02d}-{day:02d}"


def minute_label(index: int) -> str:
    total = 571 + index if index < 120 else 661 + index
    return f"{total // 60:02d}:{total % 60:02d}"


def parse_today_minute(
    body: bytes, code: str, name: str, date: str, prev_close: float, decimal: int | None
) -> dict:
    count = _u16(body, 0)
    if len(body) < 4 + count * 3:
        raise TdxError("分时报文不完整")

    divisor = price_divisor(decimal)
    points: list[dict] = []
    pos = 4
    first_price = 0
    first_avg = 0

    for index in range(count):
        price_field, pos = read_varint(body, pos)
        avg_field, pos = read_varint(body, pos)
        volume, pos = read_varint(body, pos)

        if index == 0:
            first_price = price_field
            first_avg = avg_field

        price_raw = price_field if index == 0 else first_price + price_field
        avg_raw = avg_field if index == 0 else first_avg + avg_field
        price = price_raw / (100 * divisor)
        if price <= 0:
            continue

        points.append(
            {
                "time": minute_label(index),
                "price": price,
                "avg": avg_raw / (10000 * divisor),
                "volume": volume,
            }
        )

    return {
        "code": code,
        "name": name,
        "date": date,
        "prevClose": prev_close,
        "points": points,
    }


def parse_history_minute(
    body: bytes, code: str, name: str, date: str, prev_close: float, decimal: int | None
) -> dict:
    count = _u16(body, 0)
    prev_close_raw = _f32(body, 2)
    if len(body) < 6 + count * 3:
        raise TdxError("历史分时报文不完整")

    divisor = price_divisor(decimal)
    points: list[dict] = []
    pos = 6
    price_acc = 0
    cumulative_volume = 0
    cumulative_amount = 0.0

    for index in range(count):
        price_delta, pos = read_varint(body, pos)
        _, pos = read_varint(body, pos)  # 均价增量：历史接口不提供，忽略
        volume, pos = read_varint(body, pos)

        price_acc += price_delta
        price = price_acc / (100 * divisor)
        if price <= 0:
            continue

        cumulative_volume += volume
        cumulative_amount += price * volume
        points.append(
            {
                "time": minute_label(index),
                "price": price,
                "avg": cumulative_amount / cumulative_volume if cumulative_volume > 0 else price,
                "volume": volume,
            }
        )

    return {
        "code": code,
        "name": name,
        "date": date,
        "prevClose": prev_close_raw if prev_close_raw > 0 else prev_close,
        "points": points,
    }


def parse_security_count(body: bytes) -> int:
    return _u16(body, 0)


def parse_security_list(body: bytes, market: int) -> list[dict]:
    count = _u16(body, 0)
    if len(body) < 2 + count * 37:
        raise TdxError("代码表报文不完整")

    items: list[dict] = []
    for index in range(count):
        base = 2 + index * 37
        symbol = body[base : base + 6].decode("ascii", errors="replace").rstrip("\x00")
        if len(symbol) != 6 or not symbol.isdigit():
            continue

        name = normalize_name(
            body[base + 8 : base + 24].decode("gbk", errors="replace").rstrip("\x00")
        )
        decimal = body[base + 28]
        items.append(
            {
                "code": full_code(market, symbol),
                "market": MARKET_NAMES[market],
                "symbol": symbol,
                "name": name or symbol,
                "decimal": decimal,
                "kind": classify_security(market, symbol),
            }
        )

    return items


def parse_finance(body: bytes) -> list[dict]:
    count = _u16(body, 0)
    if len(body) != 2 + count * 143:
        raise TdxError("财务报文长度异常")

    items: list[dict] = []
    for index in range(count):
        base = 2 + index * 143
        market_id = body[base]
        market = MARKET_NAMES.get(market_id)
        if market is None:
            continue

        symbol = body[base + 1 : base + 7].decode("ascii", errors="replace").rstrip("\x00")
        if len(symbol) != 6 or not symbol.isdigit():
            continue

        info = base + 7
        items.append(
            {
                "code": full_code(market_id, symbol),
                "floatShares": _f32(body, info),
                "totalShares": _f32(body, info + 16),
                "eps": _f32(body, info + 40),
                "netAssetsPerShare": _f32(body, info + 128),
            }
        )

    return items


# ---------------------------------------------------------------- 业务


class CodeIndex:
    def __init__(self) -> None:
        self.all: list[dict] = []
        self.by_code: dict[str, dict] = {}
        self.loaded = False

    def ensure(self, conn: TdxConnection) -> None:
        if self.loaded:
            return

        all_items: list[dict] = []
        client_date = int(time.strftime("%Y%m%d"))

        for market in (0, 1, 2):
            count_body = conn.request(CMD_SECURITY_COUNT, count_data(market, client_date))
            count = parse_security_count(count_body)

            start = 0
            while start < count:
                body = conn.request(CMD_SECURITY_LIST, list_data(market, start, CODE_PAGE))
                all_items.extend(parse_security_list(body, market))
                start += CODE_PAGE

        self.all = all_items
        self.by_code = {item["code"]: item for item in all_items}
        self.loaded = True


class Bridge:
    def __init__(self) -> None:
        self.conn = TdxConnection()
        self.index = CodeIndex()
        self.finance_cache: dict[str, tuple[float, dict]] = {}

    def close(self) -> None:
        self.conn.close()

    # -- 代码表 ---------------------------------------------------------

    def code_list(self) -> list[dict]:
        self.index.ensure(self.conn)
        return self.index.all

    def _name(self, code: str, symbol: str) -> str:
        return self.index.by_code.get(code, {}).get("name") or symbol

    def _decimal(self, code: str) -> int | None:
        return self.index.by_code.get(code, {}).get("decimal")

    # -- 行情 -----------------------------------------------------------

    def quotes(self, codes: list[str]) -> list[dict]:
        received_at = int(time.time() * 1000)
        unique: list[str] = []
        items: list[tuple[int, str]] = []

        for raw in codes:
            code = str(raw).strip().lower()
            if not code or code in unique:
                continue
            unique.append(code)
            try:
                market, symbol = parse_code(code)
            except TdxError:
                continue
            items.append((market, symbol))

        if not items:
            raise TdxError("当前数据源暂不支持港股/美股")

        try:
            self.index.ensure(self.conn)
        except Exception as error:  # noqa: BLE001 - 代码表失败不该拖垮行情
            print(f"[tdx] 代码表加载失败：{error}", file=sys.stderr)

        quotes: list[dict] = []
        for start in range(0, len(items), QUOTE_BATCH):
            batch = items[start : start + QUOTE_BATCH]
            body = self.conn.request(CMD_QUOTES, quote_data(batch))
            quotes.extend(parse_quotes(body, received_at, self.index.by_code))

        self._attach_finance(quotes)

        by_code = {quote["code"]: quote for quote in quotes}
        return [by_code[code] for code in unique if code in by_code]

    def _prepare_items(self, codes: list[str]) -> tuple[list[str], list[tuple[int, str]]]:
        unique: list[str] = []
        items: list[tuple[int, str]] = []
        for raw in codes:
            code = str(raw).strip().lower()
            if not code or code in unique:
                continue
            unique.append(code)
            try:
                market, symbol = parse_code(code)
            except TdxError:
                continue
            items.append((market, symbol))
        if not items:
            raise TdxError("当前数据源暂不支持港股/美股")
        try:
            self.index.ensure(self.conn)
        except Exception as error:  # noqa: BLE001 - 代码表失败不该拖垮行情
            print(f"[tdx] 代码表加载失败：{error}", file=sys.stderr)
        return unique, items

    def snapshots(self, codes: list[str]) -> list[dict]:
        """0x054c 批量快照：现价 + 买一/卖一，适合初始化一批代码。"""
        received_at = int(time.time() * 1000)
        unique, items = self._prepare_items(codes)
        quotes: list[dict] = []
        for start in range(0, len(items), QUOTE_BATCH):
            batch = items[start : start + QUOTE_BATCH]
            body = self.conn.request(CMD_SNAPSHOT, quote_data(batch))
            quotes.extend(
                parse_snapshots(body, batch, received_at, self.index.by_code)
            )
        self._attach_finance(quotes)
        by_code = {quote["code"]: quote for quote in quotes}
        return [by_code[code] for code in unique if code in by_code]

    def refresh_quotes(
        self, codes: list[str], cursors: dict[str, int] | None = None
    ) -> list[dict]:
        """0x0547 增量刷新：首次游标 0 返回五档基线；单次最多 100 只。"""
        received_at = int(time.time() * 1000)
        unique, items = self._prepare_items(codes)
        quotes: list[dict] = []
        for start in range(0, len(items), REFRESH_BATCH):
            batch = items[start : start + REFRESH_BATCH]
            body = self.conn.request(
                CMD_REFRESH, refresh_data(batch, cursors or {})
            )
            quotes.extend(parse_refresh(body, batch, received_at, self.index.by_code))
        self._attach_finance(quotes)
        by_code = {quote["code"]: quote for quote in quotes}
        return [by_code[code] for code in unique if code in by_code]

    def category_quotes(
        self,
        category: int = 6,
        sort_type: int = 0,
        start: int = 0,
        count: int = 80,
        ascending: bool = False,
        filter_raw: int = 0,
    ) -> list[dict]:
        """0x054b 分类行情：服务端排序，一页最多 80 条；category=6 沪深 A 股。"""
        received_at = int(time.time() * 1000)
        try:
            self.index.ensure(self.conn)
        except Exception as error:  # noqa: BLE001 - 代码表失败不该拖垮行情
            print(f"[tdx] 代码表加载失败：{error}", file=sys.stderr)
        body = self.conn.request(
            CMD_CATEGORY,
            category_data(
                category=category,
                sort_type=sort_type,
                start=start,
                count=count,
                ascending=ascending,
                filter_raw=filter_raw,
            ),
        )
        quotes = parse_category_quotes(body, received_at, self.index.by_code)
        self._attach_finance(quotes)
        return quotes

    def trades(
        self,
        code: str,
        start: int = 0,
        count: int = TRADE_PAGE,
        trading_date: str | None = None,
    ) -> list[dict]:
        """成交明细：不传日期走 0x0fc5，传日期走 0x0fc6。"""
        market, symbol = parse_code(code)
        try:
            self.index.ensure(self.conn)
        except Exception as error:  # noqa: BLE001 - 代码表失败不该拖垮明细
            print(f"[tdx] 代码表加载失败：{error}", file=sys.stderr)
        command = CMD_HISTORY_TICKS if trading_date else CMD_TODAY_TICKS
        body = self.conn.request(
            command,
            trades_data(market, symbol, start, count, trading_date),
        )
        return parse_trades(
            body, market, symbol, start, self.index.by_code, trading_date
        )

    def _attach_finance(self, quotes: list[dict]) -> None:
        if not quotes:
            return

        now = time.time()
        missing = [
            quote["code"]
            for quote in quotes
            if not is_index_code(MARKET_IDS.get(quote["code"][:2], -1), quote["symbol"])
            and (
                quote["code"] not in self.finance_cache
                or self.finance_cache[quote["code"]][0] < now
            )
        ]

        if missing:
            self._load_finance(missing)

        for quote in quotes:
            cached = self.finance_cache.get(quote["code"])
            if cached and cached[0] >= now:
                self._apply_finance(quote, cached[1])

    def _load_finance(self, codes: list[str]) -> None:
        items: list[tuple[int, str]] = []
        for code in codes:
            try:
                market, symbol = parse_code(code)
            except TdxError:
                continue
            items.append((market, symbol))

        try:
            for start in range(0, len(items), FINANCE_BATCH):
                batch = items[start : start + FINANCE_BATCH]
                body = self.conn.request(CMD_FINANCE, finance_data(batch))
                for finance in parse_finance(body):
                    self.finance_cache[finance["code"]] = (time.time() + FINANCE_TTL, finance)
        except Exception as error:  # noqa: BLE001 - 财务失败不影响行情
            print(f"[tdx] 财务数据拉取失败：{error}", file=sys.stderr)

    @staticmethod
    def _apply_finance(quote: dict, finance: dict) -> None:
        float_shares = finance["floatShares"] * 10000
        total_shares = finance["totalShares"] * 10000

        if float_shares > 0:
            quote["turnoverRate"] = quote["volume"] * 100 / float_shares * 100
            quote["floatCap"] = quote["price"] * float_shares / 1e8
        if total_shares > 0:
            quote["totalCap"] = quote["price"] * total_shares / 1e8
        if finance["netAssetsPerShare"] > 0:
            quote["pb"] = quote["price"] / finance["netAssetsPerShare"]

    # -- K 线 / 分时 -----------------------------------------------------

    def kline(self, code: str, period: str, count: int) -> dict:
        market, symbol = parse_code(code)
        if period not in PERIOD_RAW:
            raise TdxError("K 线周期只支持 day / week / month")

        safe_count = max(1, min(800, int(count)))
        kind = "index" if is_index_code(market, symbol) else "stock"
        body = self.conn.request(
            CMD_BARS, bars_data(market, symbol, PERIOD_RAW[period], safe_count, 1)
        )
        return {"code": code, "period": period, "bars": parse_bars(body, kind)}

    def _raw_daily(self, code: str, count: int, market: int, symbol: str) -> list[dict]:
        kind = "index" if is_index_code(market, symbol) else "stock"
        body = self.conn.request(
            CMD_BARS, bars_data(market, symbol, PERIOD_RAW["day"], count, 0)
        )
        return parse_bars(body, kind)

    def minute(self, code: str) -> dict:
        market, symbol = parse_code(code)
        daily = self._raw_daily(code, 2, market, symbol)
        last = daily[-1] if daily else None
        previous = daily[-2] if len(daily) >= 2 else None

        body = self.conn.request(CMD_MINUTE, minute_data(market, symbol))
        return parse_today_minute(
            body,
            code=code,
            name=self._name(code, symbol),
            date=last["date"] if last else "",
            prev_close=previous["close"] if previous else (last["open"] if last else 0.0),
            decimal=self._decimal(code),
        )

    def five_day(self, code: str) -> dict:
        market, symbol = parse_code(code)
        daily = self._raw_daily(code, 6, market, symbol)
        recent = daily[-5:]
        days: list[dict] = []

        for index, bar in enumerate(recent):
            previous_close = recent[index - 1]["close"] if index > 0 else bar["open"]
            date = int(bar["date"].replace("-", ""))
            body = self.conn.request(
                CMD_HISTORY_MINUTE, history_minute_data(market, symbol, date)
            )
            days.append(
                parse_history_minute(
                    body,
                    code=code,
                    name=self._name(code, symbol),
                    date=bar["date"],
                    prev_close=previous_close,
                    decimal=self._decimal(code),
                )
            )

        return {"code": code, "name": self._name(code, symbol), "days": days}


# ---------------------------------------------------------------- JSON Lines


def dispatch(bridge: Bridge, cmd: str, payload: dict) -> object:
    if cmd == "ping":
        return "pong"
    if cmd == "code_list":
        return bridge.code_list()
    if cmd == "quotes":
        return bridge.quotes(payload.get("codes") or [])
    if cmd == "snapshots":
        return bridge.snapshots(payload.get("codes") or [])
    if cmd == "refresh":
        return bridge.refresh_quotes(
            payload.get("codes") or [], payload.get("cursors") or {}
        )
    if cmd == "category":
        return bridge.category_quotes(
            category=int(payload.get("category", 6)),
            sort_type=int(payload.get("sortType", payload.get("sort_type", 0))),
            start=int(payload.get("start", 0)),
            count=int(payload.get("count", 80)),
            ascending=bool(payload.get("ascending", False)),
            filter_raw=int(payload.get("filterRaw", payload.get("filter_raw", 0))),
        )
    if cmd == "trades":
        return bridge.trades(
            payload.get("code", ""),
            start=int(payload.get("start", 0)),
            count=int(payload.get("count", TRADE_PAGE)),
            trading_date=payload.get("date") or None,
        )
    if cmd == "kline":
        return bridge.kline(
            payload.get("code", ""),
            payload.get("period", "day"),
            payload.get("count", 200),
        )
    if cmd == "minute":
        return bridge.minute(payload.get("code", ""))
    if cmd == "five_day":
        return bridge.five_day(payload.get("code", ""))
    raise TdxError(f"未知命令：{cmd}")


def main() -> None:
    if hasattr(sys.stdin, "reconfigure"):
        sys.stdin.reconfigure(encoding="utf-8")
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    bridge = Bridge()

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        request_id = None
        try:
            message = json.loads(line)
            request_id = message.get("id")
            command = message.get("cmd", "")
            if command == "shutdown":
                response = {"id": request_id, "ok": True, "result": "bye"}
                print(json.dumps(response, ensure_ascii=False), flush=True)
                break

            result = dispatch(bridge, command, message.get("payload") or {})
            response = {"id": request_id, "ok": True, "result": result}
        except Exception as error:  # noqa: BLE001 - 任何错误都要回一行，不能静默
            traceback.print_exc(file=sys.stderr)
            response = {"id": request_id, "ok": False, "error": str(error)}

        print(json.dumps(response, ensure_ascii=False, separators=(",", ":")), flush=True)

    bridge.close()


if __name__ == "__main__":
    main()
