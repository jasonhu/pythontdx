"""本地 GBBQ（股本变迁）读取。

文件来自通达信安装目录的 ``T0002/hq_cache/gbbq``（或券商定制目录），
结构：``u32 count`` + count × 29 字节记录，记录前 24 字节为三组 8 字节
XOR/查表加密，后 5 字节明文。

密钥与解密流程来自 pytdx（MIT）的 ``gbbq_reader.py``；本文件只保留只读
解密与解析，不依赖 pytdx。未提供 gbbq 文件时不伪造数据。
"""

from __future__ import annotations

import base64
import struct
import zlib
from pathlib import Path

# zlib + base64 压缩后的 4176 字节查表密钥（pytdx MIT）。
_KEY_B64 = """
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
"""

GBBQ_CATEGORY_NAMES = {
    1: "除权除息",
    2: "送配股上市",
    3: "非流通股上市",
    4: "未知股本变动",
    5: "股本变化",
    6: "增发新股",
    7: "股份回购",
    8: "增发新股上市",
    9: "转配股上市",
    10: "可转债上市",
    11: "扩缩股",
    12: "非流通股缩股",
    13: "送认购权证",
    14: "送认沽权证",
    15: "重整调整",
}

_KEY = zlib.decompress(base64.b64decode("".join(_KEY_B64.split())))
_MASK = 0xFFFFFFFF


def _u32(data: bytes, offset: int) -> int:
    return struct.unpack_from("<I", data, offset)[0]


def _decrypt_block(keys: bytes, first: int, second: int) -> tuple[int, int]:
    num = (_u32(keys, 0x44) ^ first) & _MASK
    numold = second
    for j in range(0x40, 0x00, -4):
        eax = _u32(keys, ((num & 0xFF0000) >> 16) * 4 + 0x448)
        eax = (eax + _u32(keys, (num >> 24) * 4 + 0x48)) & _MASK
        eax ^= _u32(keys, ((num & 0xFF00) >> 8) * 4 + 0x848)
        eax = (eax + _u32(keys, (num & 0xFF) * 4 + 0xC48)) & _MASK
        eax ^= _u32(keys, j)
        num, numold = (numold ^ eax) & _MASK, num
    return (numold ^ _u32(keys, 0)) & _MASK, num


def find_gbbq_path() -> Path | None:
    """按常见通达信安装目录找 gbbq；找不到返回 None（不猜）。"""
    import os

    candidates: list[Path] = []
    configured = os.environ.get("PYTHONTDX_GBBQ_PATH")
    if configured:
        candidates.append(Path(configured).expanduser())
    for root in (
        Path("C:/new_tdx"),
        Path("C:/tdx"),
        Path("D:/tdx"),
        Path("D:/zd_huatai"),
        Path("D:/通达信"),
        Path.home() / "tdx",
    ):
        candidates.append(root / "T0002" / "hq_cache" / "gbbq")
    for path in candidates:
        if path.is_file():
            return path
    return None


def read_gbbq(filepath: str | Path, strict: bool = True) -> list[dict]:
    """读取 gbbq 文件；返回市场/代码/日期/类别/四项股本变迁值。"""
    path = Path(filepath)
    if not path.is_file():
        raise FileNotFoundError(f"GBBQ 文件不存在：{path}")
    data = path.read_bytes()
    if len(data) < 4:
        return []
    count = _u32(data, 0)
    expected = 4 + count * 29
    if strict and len(data) != expected:
        raise ValueError(
            f"GBBQ 长度与记录数不符：header={count} 条，期望 {expected} 字节，实际 {len(data)}"
        )
    rows: list[dict] = []
    offset = 4
    for _ in range(count):
        if offset + 29 > len(data):
            break
        clear = bytearray()
        for _round in range(3):
            first = _u32(data, offset)
            second = _u32(data, offset + 4)
            plain_first, plain_second = _decrypt_block(_KEY, first, second)
            clear.extend(struct.pack("<II", plain_first, plain_second))
            offset += 8
        clear.extend(data[offset : offset + 5])
        offset += 5
        market, code_raw, date_raw, category, a, b, c, d = struct.unpack(
            "<B7sIBffff", bytes(clear)
        )
        code = code_raw.rstrip(b"\x00").decode("ascii", "replace")
        if len(code) != 6 or not code.isdigit():
            continue
        text = str(date_raw)
        rows.append(
            {
                "market": market,
                "code": f"{'sh' if market == 1 else 'sz' if market == 0 else 'bj'}{code}",
                "symbol": code,
                "date": f"{text[:4]}-{text[4:6]}-{text[6:8]}" if len(text) == 8 else "",
                "dateRaw": date_raw,
                "category": category,
                "categoryName": GBBQ_CATEGORY_NAMES.get(category, str(category)),
                # 29B 记录只有 4 个 float；含义随 category 变化：
                # category=1 才是「分红/配股价/送股/配股」，其余是股本字段。
                "c1": round(a, 6),
                "c2": round(b, 6),
                "c3": round(c, 6),
                "c4": round(d, 6),
            }
        )
    return rows
