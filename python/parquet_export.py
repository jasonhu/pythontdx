"""可选的 Parquet 规范化导出。

系统 Python 不默认安装 pyarrow；这是数据湖的 Parquet 出口，未安装时明确报错，
不拿 CSV/JSONL 冒充 Parquet。安装：
    python3 -m pip install --target .venv-data pyarrow
    PYTHONPATH=.venv-data python3 python/parquet_export.py
"""

from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path


class ParquetUnavailable(Exception):
    pass


def _pyarrow():
    try:
        import pyarrow as pa
        import pyarrow.parquet as pq
    except ImportError as error:  # pragma: no cover - depends on environment
        raise ParquetUnavailable(
            "未安装 pyarrow；请按 docs/03 的数据湖说明安装后再导出 Parquet"
        ) from error
    return pa, pq


def _data_dir() -> Path:
    configured = os.environ.get("STOCKLENS_DATA_DIR")
    if configured:
        return Path(configured)
    xdg = os.environ.get("XDG_DATA_HOME")
    base = Path(xdg) if xdg else Path.home() / ".local" / "share"
    return base / "stocklens" / "data"


def export_stats_parquet(
    database: Path | None = None,
    target: Path | None = None,
) -> dict:
    pa, pq = _pyarrow()
    db = database or _data_dir() / "normalized" / "tdx" / "zhb_stats" / "stats.db"
    if not db.exists():
        raise FileNotFoundError(f"stats.db 不存在：{db}")
    output = target or db.parent / "parquet"
    output.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(f"{db.as_uri()}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    files: list[dict] = []
    try:
        for table_name in ("tdxstat", "tdxstat2"):
            rows = [dict(row) for row in connection.execute(f"SELECT * FROM {table_name}")]
            if not rows:
                continue
            by_date: dict[str, list[dict]] = {}
            for row in rows:
                date = str(row.get("stats_date") or "unknown")
                by_date.setdefault(date, []).append(row)
            for date, partition in sorted(by_date.items()):
                table = pa.Table.from_pylist(partition)
                folder = output / table_name / f"trade_date={date}"
                folder.mkdir(parents=True, exist_ok=True)
                path = folder / "part-00000.parquet"
                pq.write_table(table, path, compression="zstd")
                files.append(
                    {
                        "table": table_name,
                        "tradeDate": date,
                        "rows": len(partition),
                        "path": str(path),
                        "bytes": path.stat().st_size,
                    }
                )
    finally:
        connection.close()
    manifest = {
        "schemaVersion": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "source": str(db),
        "sourceSha256": hashlib.sha256(db.read_bytes()).hexdigest(),
        "target": str(output),
        "files": files,
        "rowCount": sum(item["rows"] for item in files),
    }
    manifest_path = output / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), "utf8")
    manifest["manifest"] = str(manifest_path)
    return manifest


def main() -> int:
    try:
        result = export_stats_parquet()
    except (ParquetUnavailable, FileNotFoundError) as error:
        print(f"[parquet] {error}", file=sys.stderr)
        return 1
    print(json.dumps({k: result[k] for k in ("rowCount", "target", "manifest")}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
