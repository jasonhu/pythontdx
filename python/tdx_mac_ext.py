"""MAC（0x12xx）扩展命令：服务端信息、股票摘要、单只快照、K 线、竞价、多日分时。

协议事实参考 gotdx（MIT，`proto/mac_*.go`）并独立用 Python 实现；只保留 A 股
需要的字段，字段口径以实盘报文为准。与 `tdx_mac.py` 共用 0x1c 帧与三步握手。
"""
from __future__ import annotations

import socket
import struct
import time
from tdx_mac import MAC_HOSTS, MAC_PORT, MacError, SETUP_COMMANDS, _read_response


def _f32(data: bytes, pos: int) -> float:
    if pos + 4 > len(data):
        raise MacError("MAC 报文不完整")
    return struct.unpack_from("<f", data, pos)[0]


def _gbk(data: bytes) -> str:
    return data.decode("gbk", "replace").rstrip("\x00").strip()


def _code(market: int, symbol: str) -> bytes:
    return symbol.encode("gbk").ljust(22, b"\x00")


def _pack_command(command: int, payload: bytes) -> bytes:
    inner = struct.pack("<H", command) + payload
    return struct.pack("<BIBHH", 0x1C, 0, 1, len(inner), len(inner)) + inner


class MacSession:
    """复用一条 MAC 长连接；`request` 串行（MAC 是一问一答）。"""

    def __init__(self, host: str, timeout: float = 6.0):
        self.host = host
        self.sock = socket.create_connection((host, MAC_PORT), timeout=timeout)
        self.sock.settimeout(timeout)
        old = self.sock.gettimeout()
        for command in SETUP_COMMANDS:
            self.sock.sendall(command)
            self.sock.settimeout(0.8)
            try:
                _read_response(self.sock)
            except (socket.timeout, OSError, MacError):
                pass
            finally:
                self.sock.settimeout(old)

    def request(self, command: int, payload: bytes = b"") -> bytes:
        self.sock.sendall(_pack_command(command, payload))
        return _read_response(self.sock)

    def close(self) -> None:
        try:
            self.sock.close()
        except OSError:
            pass

    def __enter__(self):
        return self

    def __exit__(self, *_exc):
        self.close()


def open_session(hosts: tuple[str, ...] = MAC_HOSTS, timeout: float = 6.0) -> MacSession:
    last: Exception | None = None
    for host in hosts:
        try:
            return MacSession(host, timeout)
        except (OSError, MacError) as error:  # noqa: BLE001 - 逐站尝试
            last = error
    raise MacError(f"MAC 主站均不可用：{last}")


def _session(hosts: tuple[str, ...] | None = None, timeout: float = 6.0) -> MacSession:
    return open_session(hosts or MAC_HOSTS, timeout)


# ---------------------------------------------------------------- 0x120F


DEFAULT_SERVER_INFO_PAYLOAD = bytearray(68)
DEFAULT_SERVER_INFO_PAYLOAD[0:4] = bytes([0x04, 0x00, 0x2D, 0x31])
DEFAULT_SERVER_INFO_PAYLOAD[12:16] = bytes([0x00, 0x27, 0x06, 0x0E])


def parse_server_info(body: bytes) -> dict:
    """0x120F：服务端交易日/交易时段；字段偏移见 gotdx mac_server_info.go。"""
    if len(body) < 87:
        raise MacError("MAC 服务端信息过短")
    pos = 0
    count = struct.unpack_from("<H", body, pos)[0]
    pos += 2
    flags_hex = body[pos : pos + 8].hex()
    pos += 8
    tag = body[pos : pos + 3].decode("gbk", "replace").rstrip("\x00")
    pos += 3 + 9

    def date(raw: int) -> str:
        if raw < 19000101:
            return ""
        return f"{raw // 10000:04d}-{raw % 10000 // 100:02d}-{raw % 100:02d}"

    def sessions(chunk: bytes) -> list[dict]:
        items = []
        for index in range(4):
            base = index * 4
            open_min, close_min = struct.unpack_from("<HH", chunk, base)
            items.append(
                {
                    "openMinutes": open_min,
                    "closeMinutes": close_min,
                    "open": f"{open_min // 60}:{open_min % 60:02d}",
                    "close": f"{close_min // 60}:{close_min % 60:02d}",
                }
            )
        return items

    today_raw = struct.unpack_from("<I", body, pos)[0]
    pos += 4
    ts1 = struct.unpack_from("<I", body, pos)[0]
    pos += 4
    sessions1 = sessions(body[pos : pos + 16])
    pos += 16
    sessions2 = sessions(body[pos : pos + 16])
    pos += 16
    flag = body[pos]
    pos += 1
    last_day_raw = struct.unpack_from("<I", body, pos)[0]
    pos += 4
    ts2 = struct.unpack_from("<I", body, pos)[0]
    pos += 4
    last_day2_raw = struct.unpack_from("<I", body, pos)[0]
    pos += 4
    ts3 = struct.unpack_from("<I", body, pos)[0]
    pos += 4
    market_param1 = struct.unpack_from("<I", body, pos)[0]
    pos += 4
    market_param2 = struct.unpack_from("<I", body, pos)[0]
    pos += 4
    return {
        "count": count,
        "flagsHex": flags_hex,
        "tag": tag,
        "today": date(today_raw),
        "ts1": ts1,
        "sessions1": sessions1,
        "sessions2": sessions2,
        "flag": flag,
        "lastTradingDay": date(last_day_raw),
        "ts2": ts2,
        "lastTradingDay2": date(last_day2_raw),
        "ts3": ts3,
        "marketParam1": market_param1,
        "marketParam2": market_param2,
        "extraHex": body[pos:].hex() if pos < len(body) else "",
    }


def fetch_server_info(timeout: float = 6.0, hosts: tuple[str, ...] | None = None) -> dict:
    with _session(hosts, timeout) as session:
        body = session.request(0x120F, bytes(DEFAULT_SERVER_INFO_PAYLOAD))
    return parse_server_info(body)


# ---------------------------------------------------------------- 0x122A


def _symbol_info_request(market: int, symbol: str) -> bytes:
    return struct.pack("<H22sI12s", market, _code(market, symbol), 1, b"\x00" * 12)


def parse_symbol_info(body: bytes) -> dict:
    """0x122A：股票摘要；194 字节定长布局。"""
    if len(body) < 194:
        raise MacError("MAC 股票摘要过短")
    market = struct.unpack_from("<H", body, 8)[0]
    code = _gbk(body[10:32])
    name = _gbk(body[32:76])
    date_raw = struct.unpack_from("<I", body, 96)[0]
    time_raw = struct.unpack_from("<I", body, 100)[0]
    price = lambda pos: round(_f32(body, pos), 4)  # noqa: E731
    return {
        "marketId": market,
        "code": f"{'sz' if market == 0 else 'sh' if market == 1 else 'bj'}{code}",
        "symbol": code,
        "name": name,
        "datetime": _format_datetime(date_raw, time_raw),
        "activity": struct.unpack_from("<I", body, 104)[0],
        "preClose": price(108),
        "open": price(112),
        "high": price(116),
        "low": price(120),
        "close": price(124),
        "momentum": price(128),
        "volume": struct.unpack_from("<I", body, 132)[0],
        "amount": price(136),
        "inVolume": struct.unpack_from("<I", body, 140)[0],
        "outVolume": struct.unpack_from("<I", body, 144)[0],
        "decimal": struct.unpack_from("<H", body, 148)[0],
        "vr": price(182),
        "turnover": price(186),
        "avg": price(190),
    }


def fetch_symbol_info(
    code: str, timeout: float = 6.0, hosts: tuple[str, ...] | None = None
) -> dict:
    market, symbol = _parse_code(code)
    with _session(hosts, timeout) as session:
        body = session.request(0x122A, _symbol_info_request(market, symbol))
    return parse_symbol_info(body)


# ---------------------------------------------------------------- 0x122D


def _quote_detail_request(market: int, symbol: str, date: int = 0) -> bytes:
    return struct.pack(
        "<H22sHHHHHHH",
        market,
        _code(market, symbol),
        date & 0xFFFF,
        (date >> 16) & 0xFFFF,
        1,
        0,
        0,
        0,
        0,
    )


def parse_quote_detail(body: bytes) -> dict:
    """0x122D：单只快照 + 分时采样；头部 35B + 18B/点 + 汇总段。"""
    if len(body) < 35:
        raise MacError("MAC 单只快照过短")
    market = struct.unpack_from("<H", body, 0)[0]
    code = _gbk(body[2:24])
    date_raw = struct.unpack_from("<I", body, 24)[0]
    price = _f32(body, 29)
    count = struct.unpack_from("<H", body, 33)[0]
    pos = 35
    chart: list[dict] = []
    for _ in range(count):
        if pos + 18 > len(body):
            raise MacError("MAC 分时采样不完整")
        minutes = struct.unpack_from("<H", body, pos)[0]
        chart.append(
            {
                "time": _minute_label(minutes),
                "price": round(_f32(body, pos + 2), 4),
                "avg": round(_f32(body, pos + 6), 4),
                "volume": struct.unpack_from("<I", body, pos + 10)[0],
                "momentum": round(_f32(body, pos + 14), 4),
            }
        )
        pos += 18
    # 汇总段实际读取到 +116 的行业字段（+120），阈值必须按最大偏移算。
    if pos + 120 > len(body):
        raise MacError("MAC 快照汇总段过短")
    base = pos
    return {
        "marketId": market,
        "code": f"{'sz' if market == 0 else 'sh' if market == 1 else 'bj'}{code}",
        "symbol": code,
        "date": _format_date(date_raw),
        "price": round(price, 4),
        "name": _gbk(body[base : base + 44]),
        "decimal": body[base + 44],
        "category": struct.unpack_from("<H", body, base + 45)[0],
        "volUnit": round(_f32(body, base + 47), 6),
        "datetime": _format_datetime(
            struct.unpack_from("<I", body, base + 56)[0],
            struct.unpack_from("<I", body, base + 60)[0],
        ),
        "preClose": round(_f32(body, base + 64), 4),
        "open": round(_f32(body, base + 68), 4),
        "high": round(_f32(body, base + 72), 4),
        "low": round(_f32(body, base + 76), 4),
        "close": round(_f32(body, base + 80), 4),
        "momentum": round(_f32(body, base + 84), 4),
        "volume": struct.unpack_from("<I", body, base + 88)[0],
        "amount": round(_f32(body, base + 92), 2),
        "turnover": round(_f32(body, base + 108), 4),
        "avg": round(_f32(body, base + 112), 4),
        "industry": struct.unpack_from("<I", body, base + 116)[0],
        "chart": chart,
    }


def fetch_quote_detail(
    code: str, date: int = 0, timeout: float = 6.0, hosts: tuple[str, ...] | None = None
) -> dict:
    market, symbol = _parse_code(code)
    with _session(hosts, timeout) as session:
        body = session.request(0x122D, _quote_detail_request(market, symbol, date))
    return parse_quote_detail(body)


# ---------------------------------------------------------------- 0x122E

MAC_PERIODS = {
    "5m": 0,
    "15m": 1,
    "30m": 2,
    "60m": 3,
    "day": 4,
    "week": 5,
    "month": 6,
    "1m": 8,
}


def _bars_request(
    market: int,
    symbol: str,
    period: int,
    start: int,
    count: int,
    adjust: int,
    times: int = 1,
) -> bytes:
    count = max(1, min(int(count), 2000))
    return struct.pack(
        "<H22sHHIHHBBBBH4s",
        market,
        _code(market, symbol),
        period,
        max(1, times),
        max(0, start),
        count + 1,  # 多取一条做昨收基准
        adjust,
        1,
        1,
        0,
        1,
        0,
        b"\x00" * 4,
    )


def parse_symbol_bars(body: bytes, keep_first: bool = False, pre_close_hint: float | None = None) -> dict:
    """0x122E：K 线；36B/条，首条只作昨收基准。"""
    if len(body) < 33:
        raise MacError("MAC K 线响应过短")
    market = struct.unpack_from("<H", body, 0)[0]
    code = _gbk(body[2:14])
    period = body[24]
    count = struct.unpack_from("<H", body, 27)[0]
    start = struct.unpack_from("<I", body, 29)[0]
    pos = 33
    bars: list[dict] = []
    pre_close = float(pre_close_hint or 0.0)
    for index in range(count):
        if pos + 36 > len(body):
            raise MacError("MAC K 线记录不完整")
        ymd = struct.unpack_from("<I", body, pos)[0]
        seconds = struct.unpack_from("<I", body, pos + 4)[0]
        open_ = _f32(body, pos + 8)
        high = _f32(body, pos + 12)
        low = _f32(body, pos + 16)
        close = _f32(body, pos + 20)
        amount = _f32(body, pos + 24)
        volume = _f32(body, pos + 28)
        float_shares = _f32(body, pos + 32)
        pos += 36
        if index == 0 and not keep_first:
            pre_close = close
            continue
        bar = {
            "date": _bar_date(period, ymd, seconds),
            "open": round(open_, 4),
            "high": round(high, 4),
            "low": round(low, 4),
            "close": round(close, 4),
            "volume": round(volume, 4),
            "amount": round(amount, 2),
            "preClose": round(pre_close, 4),
            "floatShares": round(float_shares, 4),
        }
        if index == 0 and pre_close_hint is None:
            bar["preCloseMissing"] = True
        pre_close = close
        bars.append(bar)
    result = {
        "marketId": market,
        "code": f"{'sz' if market == 0 else 'sh' if market == 1 else 'bj'}{code}",
        "symbol": code,
        "period": period,
        "start": start,
        "count": len(bars),
        "bars": bars,
    }
    if pos + 120 <= len(body):
        base = pos
        result.update(
            {
                "name": _gbk(body[base : base + 44]),
                "decimal": body[base + 44],
                "category": struct.unpack_from("<H", body, base + 45)[0],
                "volUnit": round(_f32(body, base + 47), 6),
                "datetime": _format_datetime(
                    struct.unpack_from("<I", body, base + 56)[0],
                    struct.unpack_from("<I", body, base + 60)[0],
                ),
                "turnover": round(_f32(body, base + 108), 4),
                "avg": round(_f32(body, base + 112), 4),
                "industry": struct.unpack_from("<I", body, base + 116)[0],
            }
        )
    return result


def fetch_symbol_bars(
    code: str,
    period: str = "day",
    start: int = 0,
    count: int = 800,
    adjust: int = 0,
    times: int = 1,
    timeout: float = 8.0,
    hosts: tuple[str, ...] | None = None,
) -> dict:
    if period not in MAC_PERIODS:
        raise MacError(f"MAC 不支持周期：{period}")
    market, symbol = _parse_code(code)
    with _session(hosts, timeout) as session:
        body = session.request(
            0x122E,
            _bars_request(market, symbol, MAC_PERIODS[period], start, count, adjust, times),
        )
    return parse_symbol_bars(body)


# ---------------------------------------------------------------- 0x123D


def _auction_request(market: int, symbol: str, start: int, count: int) -> bytes:
    return struct.pack(
        "<H22sII10s",
        market,
        _code(market, symbol),
        max(0, start),
        max(1, min(int(count or 500), 2000)),
        b"\x00" * 10,
    )


def parse_auctions(body: bytes) -> dict:
    if len(body) < 36:
        raise MacError("MAC 竞价响应过短")
    market = struct.unpack_from("<H", body, 0)[0]
    code = _gbk(body[2:24])
    count = struct.unpack_from("<I", body, 24)[0]
    pos = 36
    rows: list[dict] = []
    for _ in range(count):
        if pos + 16 > len(body):
            raise MacError("MAC 竞价记录不完整")
        seconds = struct.unpack_from("<I", body, pos)[0]
        price = _f32(body, pos + 4)
        matched = struct.unpack_from("<I", body, pos + 8)[0]
        unmatched = struct.unpack_from("<i", body, pos + 12)[0]
        rows.append(
            {
                "time": _seconds_label(seconds),
                "price": round(price, 4),
                "matched": matched,
                "unmatched": abs(unmatched),
                "direction": -1 if unmatched < 0 else 1,
            }
        )
        pos += 16
    return {
        "marketId": market,
        "code": f"{'sz' if market == 0 else 'sh' if market == 1 else 'bj'}{code}",
        "symbol": code,
        "count": len(rows),
        "rows": rows,
    }


def fetch_auctions(
    code: str,
    start: int = 0,
    count: int = 500,
    timeout: float = 6.0,
    hosts: tuple[str, ...] | None = None,
) -> dict:
    market, symbol = _parse_code(code)
    with _session(hosts, timeout) as session:
        body = session.request(0x123D, _auction_request(market, symbol, start, count))
    return parse_auctions(body)


# ---------------------------------------------------------------- 0x123E


def _tick_charts_request(market: int, symbol: str, date: int, days: int) -> bytes:
    return struct.pack(
        "<H22sIHH6s", market, _code(market, symbol), max(0, date), max(1, min(days, 5)), 1, b"\x00" * 6
    )


def parse_tick_charts(body: bytes, days: int = 5) -> dict:
    """0x123E：最多 5 日分时；14B/点，按分钟回绕切日。"""
    if len(body) < 71:
        raise MacError("MAC 多日分时过短")
    market = struct.unpack_from("<H", body, 0)[0]
    code = _gbk(body[2:24])
    dates = list(struct.unpack_from("<5I", body, 24))
    pre_closes = list(struct.unpack_from("<5f", body, 44))
    count = struct.unpack_from("<H", body, 64)[0]
    total = struct.unpack_from("<H", body, 69)[0]
    pos = 71
    ticks: list[dict] = []
    for _ in range(total):
        if pos + 14 > len(body):
            raise MacError("MAC 多日分时点不完整")
        minutes = struct.unpack_from("<H", body, pos)[0]
        volume = struct.unpack_from("<H", body, pos + 10)[0]
        avg = _f32(body, pos + 6)
        ticks.append(
            {
                "minute": minutes,
                "time": _minute_label(minutes),
                "price": round(_f32(body, pos + 2), 4),
                "avg": round(avg, 4),
                "volume": volume,
                "amount": round(volume * avg * 100, 2),
            }
        )
        pos += 14
    day_list: list[dict] = []
    if count > 0 and ticks:
        current = 0
        day_ticks: list[dict] = []
        for index, tick in enumerate(ticks):
            day_ticks.append(tick)
            # 只有分钟「变小」才是新交易日；同一分钟重复点不能多切一天。
            if index + 1 < len(ticks) and ticks[index + 1]["minute"] < tick["minute"]:
                day_list.append(_day_payload(dates, pre_closes, current, day_ticks))
                current += 1
                day_ticks = []
        day_list.append(_day_payload(dates, pre_closes, current, day_ticks))
    if 0 < days < len(day_list):
        day_list = day_list[-days:]
    result = {
        "marketId": market,
        "code": f"{'sz' if market == 0 else 'sh' if market == 1 else 'bj'}{code}",
        "symbol": code,
        "count": len(day_list),
        "days": day_list,
    }
    if pos + 120 <= len(body):
        base = pos
        result.update(
            {
                "name": _gbk(body[base : base + 44]),
                "decimal": body[base + 44],
                "datetime": _format_datetime(
                    struct.unpack_from("<I", body, base + 56)[0],
                    struct.unpack_from("<I", body, base + 60)[0],
                ),
                "preClose": round(_f32(body, base + 64), 4),
                "turnover": round(_f32(body, base + 108), 4),
                "avg": round(_f32(body, base + 112), 4),
            }
        )
    return result


def _day_payload(dates: list[int], pre_closes: list[float], index: int, ticks: list[dict]) -> dict:
    date = dates[index] if index < len(dates) else 0
    pre_close = pre_closes[index] if index < len(pre_closes) else 0.0
    return {"date": _format_date(date), "preClose": round(pre_close, 4), "points": ticks}


def fetch_tick_charts(
    code: str,
    date: int = 0,
    days: int = 5,
    timeout: float = 8.0,
    hosts: tuple[str, ...] | None = None,
) -> dict:
    market, symbol = _parse_code(code)
    with _session(hosts, timeout) as session:
        body = session.request(0x123E, _tick_charts_request(market, symbol, date, days))
    return parse_tick_charts(body, days)


# ---------------------------------------------------------------- helpers


def _parse_code(code: str) -> tuple[int, str]:
    text = str(code).strip().lower()
    prefix, symbol = text[:2], text[2:]
    market = {"sz": 0, "sh": 1, "bj": 2}.get(prefix)
    if market is None or len(symbol) != 6 or not symbol.isdigit():
        raise MacError(f"MAC 只支持 sh/sz/bj + 6 位代码：{code}")
    return market, symbol


def _format_date(raw: int) -> str:
    if raw < 19000101:
        return ""
    return f"{raw // 10000:04d}-{raw % 10000 // 100:02d}-{raw % 100:02d}"


def _format_datetime(date_raw: int, time_raw: int) -> str:
    if date_raw < 19000101:
        return ""
    return (
        f"{_format_date(date_raw)} "
        f"{time_raw // 10000:02d}:{time_raw % 10000 // 100:02d}:{time_raw % 100:02d}"
    )


def _minute_label(minutes: int) -> str:
    hour = (minutes // 60) % 24
    minute = minutes % 60
    total = hour * 60 + minute + 1  # 分钟末尾，与行情展示口径一致
    return f"{(total // 60) % 24:02d}:{total % 60:02d}:00"


def _seconds_label(seconds: int) -> str:
    return f"{seconds // 3600 % 24:02d}:{seconds % 3600 // 60:02d}:{seconds % 60:02d}"


def _bar_date(period: int, ymd: int, seconds: int) -> str:
    date = _format_date(ymd)
    if period in (4, 5, 6, 9, 10, 11) or seconds == 0:
        return date
    hour = seconds // 3600
    minute = seconds % 3600 // 60
    return f"{date} {hour:02d}:{minute:02d}"




# ---------------------------------------------------------------- 0x1215/1217/122C/124A


def _file_name_field(name: str) -> bytes:
    raw = str(name or "").strip().replace("\\", "/").encode("gbk", "replace")
    if not raw or len(raw) > 70:
        raise MacError("MAC 文件名必须 1~70 字节（GBK）")
    return raw.ljust(70, b"\x00") + bytes(30)


def fetch_file_meta(session: "MacSession", filename: str, offset: int = 0) -> dict:
    """0x1215：远端文件大小/状态/哈希。"""
    body = session.request(0x1215, struct.pack("<I", int(offset)) + _file_name_field(filename))
    if len(body) < 41:
        raise MacError("MAC 文件元信息响应过短")
    return {
        "offset": struct.unpack_from("<I", body, 0)[0],
        "size": struct.unpack_from("<I", body, 4)[0],
        "flag": struct.unpack_from("<b", body, 8)[0],
        "hash": body[9:41].decode("ascii", "replace").rstrip("\x00"),
    }


def fetch_file_chunk(
    session: "MacSession",
    filename: str,
    index: int = 1,
    offset: int = 0,
    size: int = 30000,
) -> dict:
    """0x1217：按分片下载远端文件。"""
    if size < 1 or size > 60000:
        raise MacError("MAC 文件分片必须在 1~60000 字节")
    body = session.request(
        0x1217,
        struct.pack("<III", int(index), int(offset), int(size))
        + _file_name_field(filename),
    )
    if len(body) < 8:
        raise MacError("MAC 文件下载响应过短")
    chunk_index, chunk_size = struct.unpack_from("<II", body, 0)
    data = body[8:]
    if chunk_size == 0:
        raise MacError("MAC 文件分片为空（该主机可能未开放 0x1217，请用 0x06b9）")
    if len(data) < chunk_size:
        raise MacError("MAC 文件分片内容不完整")
    return {
        "index": chunk_index,
        "size": chunk_size,
        "data": data[:chunk_size],
    }


def _board_code(symbol: str) -> int:
    text = str(symbol or "").strip().upper()
    if text.startswith("US"):
        return 30000 + int(text[2:])
    if text.startswith("HK"):
        return 20000 + int(text[2:])
    if len(text) == 6 and text.isdigit():
        if text.startswith("88"):
            return int(text) - 880000 + 20000
        if text.startswith("399"):
            return int(text) - 399000 + 30000
        if text.startswith("899"):
            return int(text) - 899000 + 32000
        if text.startswith("000"):
            return 31000 + int(text)
    return int(text)


def fetch_board_members(
    session: "MacSession",
    board_symbol: str,
    start: int = 0,
    page_size: int = 80,
    sort_type: int = 0x0A,
    sort_order: int = 1,
) -> dict:
    """0x122C：板块成分股报价；响应布局与 0x122B 相同。"""
    page_size = max(1, min(80, int(page_size)))
    start = max(0, int(start))
    body = struct.pack(
        "<I9xHIHBB",
        _board_code(board_symbol),
        int(sort_type),
        int(start),
        int(page_size),
        int(sort_order),
        0,
    )
    bitmap = bytearray(16)
    for bit in range(16):
        bitmap[bit // 8] |= 1 << (bit % 8)
    body += bytes(bitmap) + bytes((0, 0, 0, 1))
    payload = session.request(0x122C, body)
    from tdx_mac import parse_quotes

    quotes = parse_quotes(payload, int(time.time() * 1000))
    return {"count": len(quotes), "quotes": quotes, "board": board_symbol}


def fetch_kline_offset(
    session: "MacSession", offset: int = 0, count: int = 128000
) -> dict:
    """0x124A：K 线索引总量/返回量（total 为大端）。"""
    body = session.request(0x124A, struct.pack("<II5x", int(offset), int(count)))
    if len(body) < 8:
        return {"total": 0, "returned": 0}
    return {
        "total": struct.unpack_from(">I", body, 0)[0],
        "returned": struct.unpack_from("<I", body, 4)[0],
    }
