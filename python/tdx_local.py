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


class LocalDayError(Exception):
    pass


def read_day_file(path: str, limit: int = 0) -> dict:
    file = Path(path).expanduser()
    if not file.is_file():
        raise LocalDayError(f"文件不存在：{file}")
    if file.suffix.lower() != ".day":
        raise LocalDayError("只支持 .day 文件")
    size = file.stat().st_size
    if size == 0 or size % RECORD.size != 0:
        raise LocalDayError(f".day 文件长度不是 32 的倍数：{size}")

    bars = []
    with file.open("rb") as handle:
        while True:
            chunk = handle.read(RECORD.size)
            if not chunk:
                break
            if len(chunk) != RECORD.size:
                raise LocalDayError("文件尾部记录不完整")
            date, open_, high, low, close, amount, volume, _ = RECORD.unpack(chunk)
            year, month, day = date // 10000, date % 10000 // 100, date % 100
            if not (1990 <= year <= 2100 and 1 <= month <= 12 and 1 <= day <= 31):
                raise LocalDayError(f"非法日期：{date}")
            if close <= 0 or open_ <= 0:
                continue
            bars.append(
                {
                    "date": f"{year:04d}-{month:02d}-{day:02d}",
                    "open": open_ / 100,
                    "high": high / 100,
                    "low": low / 100,
                    "close": close / 100,
                    "amount": round(float(amount), 2),
                    "volume": volume / 100,
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
        "bars": bars,
    }
