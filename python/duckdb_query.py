"""可选的 DuckDB 查询层：直接查 Parquet 分区。

DuckDB 不进默认依赖；未安装时明确报错。只开放 tdxstat / tdxstat2 两个视图，
拒绝 DDL/DML、文件函数与扩展加载。
"""

from __future__ import annotations

import datetime as dt
import os
import re
from decimal import Decimal
from pathlib import Path

FORBIDDEN = re.compile(
    r"(?is)\b(attach|detach|copy|create|insert|update|delete|drop|alter|export|import|"
    r"install|load|pragma|call|read_csv|read_json|read_parquet|parquet_scan|csv_scan|"
    r"httpfs|glob|shell)\b"
)


class DuckDbUnavailable(Exception):
    pass


def _duckdb():
    try:
        import duckdb
    except ImportError as error:  # pragma: no cover - depends on environment
        raise DuckDbUnavailable(
            "未安装 duckdb；请按 docs/03 的数据湖说明安装后再查询 Parquet"
        ) from error
    return duckdb


def _data_dir() -> Path:
    configured = os.environ.get("STOCKLENS_DATA_DIR")
    if configured:
        return Path(configured)
    xdg = os.environ.get("XDG_DATA_HOME")
    base = Path(xdg) if xdg else Path.home() / ".local" / "share"
    return base / "stocklens" / "data"


def _serialize(value):
    if isinstance(value, (dt.datetime, dt.date, dt.time)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, bytes):
        return value.hex()
    return value


def run_duckdb_query(sql: str, limit: int = 200) -> dict:
    duckdb = _duckdb()
    text = sql.strip().rstrip(";").strip()
    if not text:
        raise DuckDbUnavailable("SQL 不能为空")
    if not re.match(r"(?is)^(select|with)\b", text):
        raise DuckDbUnavailable("只允许 SELECT / WITH 查询")
    if ";" in text:
        raise DuckDbUnavailable("只允许一条 SQL")
    if FORBIDDEN.search(text):
        raise DuckDbUnavailable("DuckDB 查询不允许文件/DDL/DML/扩展函数")

    root = _data_dir() / "normalized" / "tdx" / "zhb_stats" / "parquet"
    if not root.exists():
        raise DuckDbUnavailable("Parquet 目录不存在，请先执行 Parquet 导出")
    safe_limit = max(1, min(500, int(limit)))
    connection = duckdb.connect(":memory:")
    try:
        for table in ("tdxstat", "tdxstat2"):
            folder = root / table
            if not folder.exists():
                continue
            pattern = str(folder / "**" / "*.parquet").replace("'", "''")
            connection.execute(
                f"CREATE VIEW {table} AS SELECT * FROM read_parquet("
                f"'{pattern}', hive_partitioning=true, union_by_name=true)"
            )
        extra_views = {}
        kline_dir = _data_dir() / "cache" / "klines"
        tick_dir = _data_dir() / "lake" / "ticks"
        if kline_dir.is_dir() and any(kline_dir.glob("*.parquet")):
            extra_views["klines"] = kline_dir / "*.parquet"
        if tick_dir.is_dir() and any(tick_dir.rglob("*.parquet")):
            extra_views["ticks"] = tick_dir / "**" / "*.parquet"
        for name, folder in extra_views.items():
            pattern = str(folder).replace("'", "''")
            connection.execute(
                f"CREATE VIEW {name} AS SELECT * FROM read_parquet("
                f"'{pattern}', hive_partitioning=true, union_by_name=true)"
            )
        result = connection.execute(f"SELECT * FROM ({text}) LIMIT {safe_limit}")
        columns = [item[0] for item in (result.description or [])]
        rows = [[_serialize(value) for value in row] for row in result.fetchall()]
        return {
            "columns": columns,
            "rows": rows,
            "rowCount": len(rows),
            "limited": len(rows) >= safe_limit,
        }
    except Exception as error:  # noqa: BLE001 - 统一成用户可读错误
        raise DuckDbUnavailable(f"DuckDB 查询失败：{error}") from error
    finally:
        connection.close()
