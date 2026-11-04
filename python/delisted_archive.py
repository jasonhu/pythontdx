"""退市 A 股日线归档：Parquet + manifest + SHA256。

0x052b 只提供日线/不复权；历史不可重放，已存在的有效文件不覆盖。
"""
from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

from parquet_store import ParquetStoreError, file_sha256, read_bars, write_bars


def _paths(root: Path, code: str) -> tuple[Path, Path]:
    safe = code.lower().replace("/", "_")
    directory = Path(root)
    return directory / f"{safe}_day.parquet", directory / f"{safe}_day.manifest.json"


def write_delisted_archive(root: Path, code: str, bars: list[dict]) -> dict:
    if not bars:
        raise ValueError("退市 K 线为空，不能归档")
    target, manifest_path = _paths(root, code)
    if target.is_file():
        try:
            existing = read_bars(target)
            manifest = json.loads(manifest_path.read_text("utf-8"))
            return {
                "path": str(target.resolve()),
                "rows": int(existing["rows"]),
                "sha256": str(manifest.get("sha256") or file_sha256(target)),
                "skipped": True,
            }
        except (OSError, ValueError, ParquetStoreError):
            # 损坏副本允许替换；保留原文件由调用方决定是否隔离。
            pass
    target.parent.mkdir(parents=True, exist_ok=True)
    write_bars(target, code, bars)
    generated = datetime.now().astimezone().isoformat(timespec="seconds")
    digest = file_sha256(target)
    manifest = {
        "schema": "pythontdx.delisted_kline.v1",
        "source": "TDX 7709 0x052b",
        "code": code,
        "period": "day",
        "adjust": "none",
        "rows": len(bars),
        "generatedAt": generated,
        "sha256": digest,
        "file": target.name,
    }
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return {
        "path": str(target.resolve()),
        "rows": len(bars),
        "sha256": digest,
        "generatedAt": generated,
        "skipped": False,
    }


def list_delisted_archives(root: Path, limit: int = 100) -> list[dict]:
    directory = Path(root)
    if not directory.is_dir():
        return []
    items: list[dict] = []
    for path in sorted(directory.glob("*_day.manifest.json"), reverse=True):
        try:
            manifest = json.loads(path.read_text("utf-8"))
        except (OSError, ValueError):
            continue
        parquet = path.parent / str(manifest.get("file") or "")
        items.append(
            {
                **manifest,
                "path": str(parquet.resolve()),
                "size": parquet.stat().st_size if parquet.is_file() else 0,
            }
        )
    return items[: max(1, min(200, int(limit)))]
