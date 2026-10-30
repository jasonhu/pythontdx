"""全市场快照归档：按 trade_date 分区，JSONL.gz + CSV + manifest。"""
from __future__ import annotations

import csv
import gzip
import hashlib
import json
from pathlib import Path

FIELDS = (
    "code",
    "name",
    "price",
    "prevClose",
    "open",
    "high",
    "low",
    "changePct",
    "volume",
    "amount",
    "turnoverRate",
    "volumeRatio",
    "riseSpeed",
)


def write_snapshot_archive(
    root: Path,
    quotes: list[dict],
    trade_date: str,
    generated_at: str,
) -> dict:
    root.mkdir(parents=True, exist_ok=True)
    jsonl_path = root / "quotes.jsonl.gz"
    with gzip.open(jsonl_path, "wt", encoding="utf-8") as handle:
        for quote in quotes:
            handle.write(
                json.dumps(quote, ensure_ascii=False, separators=(",", ":")) + "\n"
            )
    csv_path = root / "quotes.csv"
    with csv_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(FIELDS)
        for quote in quotes:
            writer.writerow([quote.get(field, "") for field in FIELDS])
    digest = hashlib.sha256(jsonl_path.read_bytes()).hexdigest()
    manifest = {
        "source": "TDX MAC 0x122B",
        "tradeDate": trade_date,
        "generatedAt": generated_at,
        "rows": len(quotes),
        "parserVersion": 1,
        "sha256": digest,
        "files": [jsonl_path.name, csv_path.name],
    }
    manifest_path = root / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return {
        "dir": str(root.resolve()),
        "rows": len(quotes),
        "sha256": digest,
        "generatedAt": generated_at,
        "tradeDate": trade_date,
    }


def list_snapshot_archives(root: Path, limit: int = 20) -> list[dict]:
    """列出已归档分区；按 tradeDate 倒序，供数据工具核对。"""
    if not root.is_dir():
        return []
    items: list[dict] = []
    for child in root.iterdir():
        if not child.is_dir() or not child.name.startswith("trade_date="):
            continue
        manifest_path = child / "manifest.json"
        if not manifest_path.is_file():
            continue
        try:
            manifest = json.loads(manifest_path.read_text("utf-8"))
        except (OSError, ValueError):
            continue
        files = [child / name for name in manifest.get("files") or []]
        size = sum(path.stat().st_size for path in files if path.is_file())
        items.append(
            {
                "dir": str(child.resolve()),
                "tradeDate": str(manifest.get("tradeDate") or child.name.split("=", 1)[1]),
                "rows": int(manifest.get("rows") or 0),
                "sha256": str(manifest.get("sha256") or ""),
                "generatedAt": str(manifest.get("generatedAt") or ""),
                "size": size,
            }
        )
    items.sort(key=lambda item: (item["tradeDate"], item["generatedAt"]), reverse=True)
    return items[: max(1, min(100, int(limit)))]
