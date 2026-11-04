"""通达信本地日线文件（.day）读取。

文件格式（32 字节/条）:
  uint32 date(YYYYMMDD), int32 open/high/low/close（分）, float32 amount,
  int32 volume（股）, int32 reserved.

只读、不改原文件；成交量换算成“手”，与 0x052d 的 KLineBar 对齐。
"""
from __future__ import annotations

import struct
from pathlib import Path

RECORD = struct.Struct("<IIIIIfII")

# 证券类型 → (价格系数, 成交量系数)。通达信本地文件按代码段存不同量纲：
# 沪 B / 基金 / 债券是千分之一元，指数成交量不除 100。
# 参考 eltdx `offline/daily_bar.py` 的规则，在本项目内独立实现。
SECURITY_COEFFICIENTS = {
    "SH_A_STOCK": (0.01, 0.01),
    "SH_B_STOCK": (0.001, 0.01),
    "SH_INDEX": (0.01, 1.0),
    "SH_FUND": (0.001, 1.0),
    "SH_BOND": (0.001, 1.0),
    "SZ_A_STOCK": (0.01, 0.01),
    "SZ_B_STOCK": (0.01, 0.01),
    "SZ_INDEX": (0.01, 1.0),
    "SZ_FUND": (0.001, 0.01),
    "SZ_BOND": (0.001, 0.01),
}


def detect_security_type(filename: str) -> str:
    """按交易所代码段判断证券类型；无法识别返回 UNKNOWN（不猜成 A 股）。"""
    base = Path(filename).name.lower()
    exchange = base[:2]
    head = base[2:4]
    if exchange == "sz":
        if head in ("00", "30"):
            return "SZ_A_STOCK"
        if head == "20":
            return "SZ_B_STOCK"
        if head == "39":
            return "SZ_INDEX"
        if head in ("15", "16", "17", "18"):
            return "SZ_FUND"
        if head in ("10", "11", "12", "13", "14"):
            return "SZ_BOND"
    elif exchange == "sh":
        if head in ("60", "68"):
            return "SH_A_STOCK"
        if head == "90":
            return "SH_B_STOCK"
        if head in ("00", "88", "99"):
            return "SH_INDEX"
        if head in ("50", "51", "52", "53", "55", "56", "58"):
            return "SH_FUND"
        if head in ("01", "10", "11", "12", "13", "14", "20"):
            return "SH_BOND"
    return "UNKNOWN"


def security_coefficients(filename: str) -> tuple[float, float]:
    """返回 (价格系数, 成交量系数)；未知类型按 A 股 0.01/0.01。"""
    return SECURITY_COEFFICIENTS.get(detect_security_type(filename), (0.01, 0.01))


class LocalDayError(Exception):
    pass


def read_day_file(path: str, limit: int = 0) -> dict:
    file = Path(path).expanduser()
    if not file.is_file():
        raise LocalDayError(f"文件不存在：{file}")
    if file.suffix.lower() != ".day":
        raise LocalDayError("只支持 .day 文件")
    size = file.stat().st_size
    if size < RECORD.size:
        raise LocalDayError(f".day 文件不足一条记录：{size} 字节")
    # 残尾（不足 32 字节）容忍：通达信写盘/下载中断常留下截断文件，
    # 能读多少读多少，不能因为尾巴缺几个字节让整份历史读不出来。
    price_coeff, volume_coeff = security_coefficients(file.name)

    bars = []
    invalid_dates = 0
    with file.open("rb") as handle:
        while True:
            chunk = handle.read(RECORD.size)
            if not chunk:
                break
            if len(chunk) != RECORD.size:
                break
            date, open_, high, low, close, amount, volume, _ = RECORD.unpack(chunk)
            year, month, day = date // 10000, date % 10000 // 100, date % 100
            if not (1990 <= year <= 2100 and 1 <= month <= 12 and 1 <= day <= 31):
                # 单条脏日期不该让整份历史读不出来；计数后跳过。
                invalid_dates += 1
                continue
            if close <= 0 or open_ <= 0:
                continue
            bars.append(
                {
                    "date": f"{year:04d}-{month:02d}-{day:02d}",
                    "open": round(open_ * price_coeff, 4),
                    "high": round(high * price_coeff, 4),
                    "low": round(low * price_coeff, 4),
                    "close": round(close * price_coeff, 4),
                    "amount": round(float(amount), 2),
                    "volume": round(volume * volume_coeff, 2),
                }
            )
    if limit > 0:
        bars = bars[-limit:]
    if not bars:
        raise LocalDayError("没有有效的日线记录")
    return {
        "path": str(file.resolve()),
        "count": len(bars),
        "firstDate": bars[0]["date"],
        "lastDate": bars[-1]["date"],
        "securityType": detect_security_type(file.name),
        "priceCoefficient": price_coeff,
        "volumeCoefficient": volume_coeff,
        "invalidDates": invalid_dates,
        "bars": bars,
    }


MIN_LC = struct.Struct("<HHfffffII")
MIN_5 = struct.Struct("<HHIIIIfII")


def _decode_date(num: int) -> tuple[int, int, int]:
    return num // 2048 + 2004, (num % 2048) // 100, (num % 2048) % 100


def read_min_file(path: str, limit: int = 0) -> dict:
    file = Path(path).expanduser()
    if not file.is_file():
        raise LocalDayError(f"文件不存在：{file}")
    suffix = file.suffix.lower()
    if suffix not in {".lc1", ".lc5", ".5"}:
        raise LocalDayError("只支持 .lc1/.lc5/.5 分钟文件")
    fmt = MIN_5 if suffix == ".5" else MIN_LC
    data = file.read_bytes()
    bars = []
    for offset in range(0, len(data) - fmt.size + 1, fmt.size):
        date_num, time_num, op, hi, lo, cl, amount, vol, _ = fmt.unpack_from(data, offset)
        year, month, day = _decode_date(date_num)
        hour, minute = time_num // 60, time_num % 60
        if not (1990 <= year <= 2100 and 1 <= month <= 12 and 1 <= day <= 31):
            continue
        if suffix == ".5":
            op, hi, lo, cl = op / 100, hi / 100, lo / 100, cl / 100
        if cl <= 0:
            continue
        bars.append(
            {
                "date": f"{year:04d}-{month:02d}-{day:02d} {hour:02d}:{minute:02d}",
                "open": round(op, 2),
                "high": round(hi, 2),
                "low": round(lo, 2),
                "close": round(cl, 2),
                "amount": round(float(amount), 2),
                "volume": round(float(vol) / 100, 2),
            }
        )
    if limit > 0:
        bars = bars[-limit:]
    if not bars:
        raise LocalDayError("没有有效的分钟记录")
    return {
        "path": str(file.resolve()),
        "count": len(bars),
        "firstDate": bars[0]["date"],
        "lastDate": bars[-1]["date"],
        "bars": bars,
    }


def read_local_file(path: str, limit: int = 0) -> dict:
    suffix = Path(path).suffix.lower()
    if suffix == ".day":
        return read_day_file(path, limit)
    return read_min_file(path, limit)


def write_day_file(path: str, bars: list[dict]) -> dict:
    """把 bar 列表写成通达信 .day（原子替换；价格/量按证券类型反向换算）。"""
    file = Path(path).expanduser()
    if file.suffix.lower() != ".day":
        raise LocalDayError("输出文件必须使用 .day 扩展名")
    if not bars:
        raise LocalDayError("没有可写入的 K 线")
    price_coeff, volume_coeff = security_coefficients(file.name)
    records = []
    for bar in bars:
        date = int(str(bar["date"])[:10].replace("-", ""))
        if not (19900101 <= date <= 21001231):
            raise LocalDayError(f"非法日期：{bar['date']}")
        records.append(
            RECORD.pack(
                date,
                int(round(float(bar["open"]) / price_coeff)),
                int(round(float(bar["high"]) / price_coeff)),
                int(round(float(bar["low"]) / price_coeff)),
                int(round(float(bar["close"]) / price_coeff)),
                float(bar.get("amount", 0)),
                int(round(float(bar.get("volume", 0)) / volume_coeff)),
                0,
            )
        )
    file.parent.mkdir(parents=True, exist_ok=True)
    temporary = file.with_suffix(".tmp")
    temporary.write_bytes(b"".join(records))
    temporary.replace(file)
    return {
        "path": str(file.resolve()),
        "count": len(records),
        "securityType": detect_security_type(file.name),
        "priceCoefficient": price_coeff,
        "volumeCoefficient": volume_coeff,
    }



def _encode_date(date_text: str) -> int:
    value = date_text[:10]
    year, month, day = int(value[:4]), int(value[5:7]), int(value[8:10])
    return (year - 2004) * 2048 + month * 100 + day


def write_min_file(path: str, bars: list[dict]) -> dict:
    """写 .lc1/.lc5（float32）或 .5（整数分），原子替换。"""
    file = Path(path).expanduser()
    suffix = file.suffix.lower()
    if suffix not in {".lc1", ".lc5", ".5"}:
        raise LocalDayError("输出文件必须使用 .lc1/.lc5/.5 扩展名")
    if not bars:
        raise LocalDayError("没有可写入的分钟线")
    records = []
    for bar in bars:
        date_text = str(bar["date"])
        clock = date_text[11:16] if len(date_text) >= 16 else "09:30"
        try:
            hour, minute = int(clock[:2]), int(clock[3:5])
        except ValueError as error:
            raise LocalDayError(f"非法时间：{bar['date']}") from error
        date_num = _encode_date(date_text)
        time_num = hour * 60 + minute
        op, hi, lo, cl = (float(bar[key]) for key in ("open", "high", "low", "close"))
        amount = float(bar.get("amount", 0))
        volume = int(round(float(bar.get("volume", 0)) * 100))
        if suffix == ".5":
            records.append(
                MIN_5.pack(
                    date_num,
                    time_num,
                    int(round(op * 100)),
                    int(round(hi * 100)),
                    int(round(lo * 100)),
                    int(round(cl * 100)),
                    amount,
                    volume,
                    0,
                )
            )
        else:
            records.append(MIN_LC.pack(date_num, time_num, op, hi, lo, cl, amount, volume, 0))
    file.parent.mkdir(parents=True, exist_ok=True)
    temporary = file.with_suffix(".tmp")
    temporary.write_bytes(b"".join(records))
    temporary.replace(file)
    return {"path": str(file.resolve()), "count": len(records)}
