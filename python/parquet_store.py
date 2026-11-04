"""Parquet 存储层：K 线与逐笔的统一列式格式。

为什么用 Parquet：
  · 列式 + ZSTD，扫描单个字段时不必反序列化整行 JSON；
  · DuckDB / pandas / Polars 都能直接读；
  · 文件按 symbol/period 或 trade_date+code 分区，适合长期数据湖。

这里只用 DuckDB 读写 Parquet，不依赖 pyarrow：DuckDB 已经承担查询层，
再引入一份 Arrow 运行时会让 sidecar 编译更慢、单文件更大。
"""
from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Any


class ParquetStoreError(ValueError):
    """DuckDB 依赖缺失或 Parquet 文件损坏。"""


def _duckdb():
    try:
        import duckdb
    except ImportError as error:  # pragma: no cover - depends on environment
        raise ParquetStoreError(
            "未安装 duckdb；请执行 python3 -m pip install -r requirements.txt"
        ) from error
    return duckdb


BAR_COLUMNS = (
    "date",
    "open",
    "close",
    "high",
    "low",
    "volume",
    "amount",
    "upCount",
    "downCount",
)
TICK_COLUMNS = (
    "index",
    "timeSeconds",
    "timeMinutes",
    "time",
    "price",
    "volume",
    "orderCount",
    "status",
    "side",
    "eventKind",
    "tradeAmount",
)

_BAR_TYPES = (
    ("code", "VARCHAR"),
    ("date", "VARCHAR"),
    ("open", "DOUBLE"),
    ("close", "DOUBLE"),
    ("high", "DOUBLE"),
    ("low", "DOUBLE"),
    ("volume", "DOUBLE"),
    ("amount", "DOUBLE"),
    ("upCount", "BIGINT"),
    ("downCount", "BIGINT"),
)
_TICK_TYPES = (
    ("code", "VARCHAR"),
    ("index", "BIGINT"),
    ("timeSeconds", "BIGINT"),
    ("timeMinutes", "BIGINT"),
    ("time", "VARCHAR"),
    ("price", "DOUBLE"),
    ("volume", "DOUBLE"),
    ("orderCount", "BIGINT"),
    ("status", "BIGINT"),
    ("side", "VARCHAR"),
    ("eventKind", "VARCHAR"),
    ("tradeAmount", "DOUBLE"),
)


def _sql_path(path: Path) -> str:
    return str(path.resolve()).replace("'", "''")


def _write(target: Path, rows: list[dict[str, Any]], types: tuple) -> Path:
    """原子写 Parquet；.part 文件名不会被 DuckDB 的 *.parquet 匹配。"""
    duckdb = _duckdb()
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_name(f".{target.name}.part")
    columns = ", ".join(f"{name} {kind}" for name, kind in types)
    placeholders = ", ".join("?" for _ in types)
    row_placeholder = f"({placeholders})"
    names = [name for name, _ in types]
    values = [tuple(row.get(name) for name in names) for row in rows]
    connection = duckdb.connect(":memory:")
    try:
        connection.execute(f"CREATE TABLE data ({columns})")
        # DuckDB 的 executemany 逐行开销很大；批量多行 INSERT 快一个数量级。
        for start in range(0, len(values), 500):
            chunk = values[start : start + 500]
            sql = "INSERT INTO data VALUES " + ", ".join([row_placeholder] * len(chunk))
            connection.execute(sql, [value for row in chunk for value in row])
        connection.execute(
            f"COPY data TO '{_sql_path(temporary)}' "
            f"(FORMAT PARQUET, COMPRESSION ZSTD)"
        )
    except Exception as error:  # noqa: BLE001 - 统一成可读错误
        raise ParquetStoreError(f"Parquet 写入失败：{error}") from error
    finally:
        connection.close()
    temporary.replace(target)
    return target


def _read(target: Path, columns: tuple[str, ...]) -> list[dict[str, Any]]:
    duckdb = _duckdb()
    connection = duckdb.connect(":memory:")
    try:
        # 旧缓存没有 amount 列；按实际 schema 投影并给缺失字段补 None，
        # 不能因为一次列升级就让用户已有的 Parquet 全部读不出来。
        description = connection.execute(
            f"DESCRIBE SELECT * FROM read_parquet('{_sql_path(target)}')"
        ).fetchall()
        available = {row[0] for row in description}
        present = [name for name in columns if name in available]
        if not present:
            return []
        projection = ", ".join(present)
        result = connection.execute(
            f"SELECT {projection} FROM read_parquet('{_sql_path(target)}')"
        )
        names = [item[0] for item in result.description]
        rows = []
        for values in result.fetchall():
            row = dict(zip(names, values))
            for name in columns:
                row.setdefault(name, None)
            rows.append(row)
        return rows
    except Exception as error:  # noqa: BLE001 - 统一成可读错误
        raise ParquetStoreError(f"Parquet 读取失败：{error}") from error
    finally:
        connection.close()


def write_bars(target: Path, code: str, bars: list[dict[str, Any]]) -> Path:
    if not bars:
        raise ParquetStoreError("K 线为空，不能写 Parquet")
    rows = [{**bar, "code": code} for bar in bars]
    return _write(target, rows, _BAR_TYPES)


def read_bars(target: Path) -> dict[str, Any]:
    bars = _read(target, BAR_COLUMNS)
    return {"bars": bars, "rows": len(bars)}


def write_ticks(target: Path, code: str, ticks: list[dict[str, Any]]) -> Path:
    if not ticks:
        raise ParquetStoreError("逐笔为空，不能写 Parquet")
    rows = [{**tick, "code": code} for tick in ticks]
    return _write(target, rows, _TICK_TYPES)


def read_ticks(target: Path) -> dict[str, Any]:
    ticks = _read(target, TICK_COLUMNS)
    return {"ticks": ticks, "rows": len(ticks)}


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()
