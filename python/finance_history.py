"""历史专业财务（gpcw）读取与解析。

服务器文件 `tdxfin/gpcw.txt` 是清单（`filename,md5,filesize`），对应
`tdxfin/gpcwYYYYMMDD.zip` 里只有一个 `gpcw*.dat`。`dat` 布局（公开资料一致）：

    20B 头：<h I H L L L>  unknown, report_date, max_count, unknown1,
                           report_size, unknown2
    索引：max_count × 11B（6s 代码 + 1B 市场 + u32 绝对偏移）
    数据：每条 report_size 字节，按 float32 读取

我们只做只读解析与归档：`code/market/reportDate/fields`，`fields` 保留原始顺序；
字段名不在服务器协议里，不臆造列名。
"""
from __future__ import annotations

import io
import struct
import zipfile

MAX_ZIP_BYTES = 64 * 1024 * 1024
MAX_DAT_BYTES = 256 * 1024 * 1024
MAX_FIELDS = 4096
MAX_TOTAL_FLOATS = 4 * 1024 * 1024


class FinanceHistoryError(ValueError):
    pass


def parse_file_list(data: bytes) -> list[dict]:
    """解析 gpcw.txt：每行 filename,md5,filesize。"""
    if not data:
        return []
    text = data.decode("utf-8", "replace")
    entries: list[dict] = []
    for line in text.splitlines():
        parts = [item.strip() for item in line.split(",")]
        if len(parts) < 3:
            continue
        filename, md5 = parts[0], parts[1]
        try:
            size = int(parts[2])
        except ValueError:
            continue
        if not filename.lower().endswith((".zip", ".dat")):
            continue
        entries.append({"filename": filename, "md5": md5, "size": size})
    return entries


def extract_dat(zip_bytes: bytes) -> bytes:
    if len(zip_bytes) > MAX_ZIP_BYTES:
        raise FinanceHistoryError("历史财务 zip 超出体积上限")
    try:
        archive = zipfile.ZipFile(io.BytesIO(zip_bytes))
    except zipfile.BadZipFile as error:
        raise FinanceHistoryError(f"历史财务 zip 非法：{error}") from error
    infos = archive.infolist()
    if len(infos) > 64:
        raise FinanceHistoryError("历史财务 zip 条目过多")
    dat_infos = [info for info in infos if info.filename.lower().endswith(".dat")]
    if not dat_infos:
        raise FinanceHistoryError("历史财务 zip 中没有 .dat")
    info = dat_infos[0]
    if info.flag_bits & 0x1:
        raise FinanceHistoryError("历史财务 zip 条目被加密")
    if info.file_size > MAX_DAT_BYTES:
        raise FinanceHistoryError("历史财务 dat 超出体积上限")
    data = archive.read(info)
    if len(data) > MAX_DAT_BYTES:
        raise FinanceHistoryError("历史财务 dat 实际长度超出上限")
    return data


def parse_dat(data: bytes, report_date: int = 0) -> list[dict]:
    header = struct.Struct("<hIHLLL")
    if len(data) < header.size:
        return []
    _unknown, dat_report_date, max_count, _unknown1, report_size, _unknown2 = (
        header.unpack_from(data, 0)
    )
    if report_date == 0:
        report_date = int(dat_report_date)
    if report_size == 0:
        return []
    if report_size % 4 != 0 or report_size // 4 > MAX_FIELDS:
        raise FinanceHistoryError(f"历史财务记录长度非法：{report_size}")
    fields_count = report_size // 4
    record_format = struct.Struct(f"<{fields_count}f")
    index_base = header.size
    rows: list[dict] = []
    seen_offsets: set[int] = set()
    total_floats = 0
    for index in range(max_count):
        position = index_base + index * 11
        if position + 11 > len(data):
            break
        code_bytes, market_byte, offset = struct.unpack_from("<6scL", data, position)
        code = code_bytes.decode("ascii", "replace").rstrip("\x00")
        if not code or offset == 0:
            continue
        if offset in seen_offsets:
            # 重复索引只可能是构造/损坏数据；跳过这一条，不丢整包其它股票。
            continue
        if offset + record_format.size > len(data):
            continue
        seen_offsets.add(offset)
        total_floats += fields_count
        if total_floats > MAX_TOTAL_FLOATS:
            raise FinanceHistoryError("历史财务解析量超出上限")
        values = list(record_format.unpack_from(data, offset))
        rows.append(
            {
                "code": f"{'sz' if market_byte[0] == 0 else 'sh' if market_byte[0] == 1 else 'bj'}{code}",
                "symbol": code,
                "marketId": market_byte[0],
                "reportDate": f"{report_date // 10000:04d}-{report_date % 10000 // 100:02d}-{report_date % 100:02d}"
                if report_date >= 19000101
                else "",
                "reportDateRaw": report_date,
                "fieldCount": fields_count,
                "fields": values,
            }
        )
    return rows


def parse_zip(zip_bytes: bytes, report_date: int = 0) -> list[dict]:
    return parse_dat(extract_dat(zip_bytes), report_date)
