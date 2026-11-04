"""通用协议数据归档：JSONL.gz + 可选 CSV + manifest + SHA256。

为什么单独一个模块：eltdx 的协议补齐过程中，很多「一次性快照」类数据
（特殊涨跌停表、财务快照、GBBQ 等）不需要各自发明一套文件格式。
统一按 trade_date 分区、保留原始行、写 manifest，后续 DuckDB/Pandas 可直接读。
"""
from __future__ import annotations

import csv
import gzip
import hashlib
import json
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_dataset_archive(
    root: Path,
    dataset: str,
    rows: Iterable[dict[str, Any]],
    *,
    source: str,
    trade_date: str,
    fields: list[str] | None = None,
    generated_at: str | None = None,
) -> dict:
    """写一个 trade_date 分区；已有同分区时保留第一份，不覆盖。"""
    directory = Path(root) / f"trade_date={trade_date}"
    manifest_path = directory / "manifest.json"
    if manifest_path.is_file():
        try:
            manifest = json.loads(manifest_path.read_text("utf-8"))
        except (OSError, ValueError):
            manifest = {}
        return {
            "dir": str(directory.resolve()),
            "dataset": dataset,
            "tradeDate": trade_date,
            "rows": int(manifest.get("rows") or 0),
            "sha256": str(manifest.get("sha256") or ""),
            "generatedAt": str(manifest.get("generatedAt") or ""),
            "skipped": True,
        }

    directory.mkdir(parents=True, exist_ok=True)
    materialized = [dict(row) for row in rows]
    jsonl_path = directory / f"{dataset}.jsonl.gz"
    with gzip.open(jsonl_path, "wt", encoding="utf-8") as handle:
        for row in materialized:
            handle.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n")
    files = [jsonl_path.name]
    if fields:
        csv_path = directory / f"{dataset}.csv"
        with csv_path.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.writer(handle)
            writer.writerow(fields)
            for row in materialized:
                writer.writerow([row.get(field, "") for field in fields])
        files.append(csv_path.name)
    digest = _sha256(jsonl_path)
    generated = generated_at or datetime.now().astimezone().isoformat(timespec="seconds")
    manifest = {
        "schema": f"pythontdx.{dataset}.v1",
        "source": source,
        "tradeDate": trade_date,
        "generatedAt": generated,
        "rows": len(materialized),
        "sha256": digest,
        "files": files,
    }
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return {
        "dir": str(directory.resolve()),
        "dataset": dataset,
        "tradeDate": trade_date,
        "rows": len(materialized),
        "sha256": digest,
        "generatedAt": generated,
        "skipped": False,
    }


def list_dataset_archives(root: Path, limit: int = 50) -> list[dict]:
    directory = Path(root)
    if not directory.is_dir():
        return []
    items: list[dict] = []
    for path in sorted(directory.glob("trade_date=*/manifest.json"), reverse=True):
        try:
            manifest = json.loads(path.read_text("utf-8"))
        except (OSError, ValueError):
            continue
        files = [path.parent / name for name in manifest.get("files") or []]
        items.append(
            {
                **manifest,
                "dir": str(path.parent.resolve()),
                "size": sum(item.stat().st_size for item in files if item.is_file()),
            }
        )
    return items[: max(1, min(100, int(limit)))]
