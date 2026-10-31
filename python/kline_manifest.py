"""K 线缓存 manifest：给每个 Parquet 缓存补 rows/SHA256/周期元数据。"""
from __future__ import annotations

import json
import os
from datetime import datetime
from pathlib import Path

from parquet_store import file_sha256


def manifest_path(data_path: Path) -> Path:
    return data_path.with_name(f"{data_path.name}.manifest.json")


def _duckdb():
    try:
        import duckdb
    except ImportError as error:  # pragma: no cover
        raise ValueError("未安装 duckdb") from error
    return duckdb


def row_count(data_path: Path) -> int:
    duckdb = _duckdb()
    connection = duckdb.connect(":memory:")
    try:
        row = connection.execute(
            f"SELECT count(*) FROM read_parquet('{str(data_path.resolve()).replace(chr(39), chr(39) * 2)}')"
        ).fetchone()
    finally:
        connection.close()
    return int(row[0]) if row else 0


def write_kline_manifest(data_path: Path, metadata: dict | None = None) -> dict:
    meta = dict(metadata or {})
    rows = row_count(data_path)
    payload = {
        "schema": "stocklens.kline_cache.v1",
        "file": data_path.name,
        "rows": rows,
        "bytes": data_path.stat().st_size,
        "sha256": file_sha256(data_path),
        "fetchedAt": meta.get("fetchedAt")
        or datetime.now().astimezone().isoformat(timespec="seconds"),
        **meta,
    }
    target = manifest_path(data_path)
    temporary = target.with_name(f".{target.name}.part")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(temporary, target)
    return payload


def backfill_kline_manifests(root: Path) -> dict:
    created = 0
    skipped = 0
    failed = 0
    for data_path in sorted(Path(root).glob("*.parquet")):
        if manifest_path(data_path).is_file():
            skipped += 1
            continue
        try:
            write_kline_manifest(data_path, {"source": "legacy-backfill"})
            created += 1
        except Exception:  # noqa: BLE001
            failed += 1
    return {"created": created, "skipped": skipped, "failed": failed}


def verify_kline_manifests(root: Path, limit: int = 500) -> dict:
    checked = 0
    failed = 0
    details: list[dict] = []
    for manifest in sorted(Path(root).glob("*.parquet.manifest.json"))[:limit]:
        checked += 1
        try:
            payload = json.loads(manifest.read_text("utf-8"))
            data_path = manifest.parent / str(payload.get("file") or "")
            if not data_path.is_file():
                raise ValueError("数据文件缺失")
            if file_sha256(data_path) != payload.get("sha256"):
                raise ValueError("SHA256 不匹配")
            if int(payload.get("rows", -1)) < 0:
                raise ValueError("rows 非法")
        except Exception as error:  # noqa: BLE001
            failed += 1
            details.append({"manifest": str(manifest), "error": str(error)})
    return {"checked": checked, "failed": failed, "details": details[:5]}
