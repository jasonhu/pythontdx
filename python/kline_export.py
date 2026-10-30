"""K 线批量导出：CSV + JSONL.gz + manifest（可直接用于离线分析/ML）。"""
from __future__ import annotations

import csv
import gzip
import hashlib
import json
from pathlib import Path


def write_kline_export(
    root: Path,
    bars_by_code: dict[str, list[dict]],
    period: str,
    adjust: str,
    generated_at: str,
) -> dict:
    root.mkdir(parents=True, exist_ok=True)
    files: list[str] = []
    rows = 0
    manifest_files: list[dict] = []
    for code, bars in bars_by_code.items():
        base = f"{code}-{period}"
        csv_path = root / f"{base}.csv"
        with csv_path.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.writer(handle)
            writer.writerow(["date", "open", "high", "low", "close", "volume"])
            for bar in bars:
                writer.writerow(
                    [bar.get("date", ""), bar.get("open", ""), bar.get("high", ""), bar.get("low", ""), bar.get("close", ""), bar.get("volume", "")]
                )
        jsonl_path = root / f"{base}.jsonl.gz"
        with gzip.open(jsonl_path, "wt", encoding="utf-8") as handle:
            for bar in bars:
                handle.write(json.dumps(bar, ensure_ascii=False, separators=(",", ":")) + "\n")
        digest = hashlib.sha256(jsonl_path.read_bytes()).hexdigest()
        rows += len(bars)
        files.extend([str(csv_path), str(jsonl_path)])
        manifest_files.append(
            {"code": code, "period": period, "rows": len(bars), "jsonl": jsonl_path.name, "sha256": digest}
        )
    manifest = {
        "generatedAt": generated_at,
        "period": period,
        "adjust": adjust,
        "rows": rows,
        "files": manifest_files,
    }
    manifest_path = root / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    files.append(str(manifest_path))
    return {"dir": str(root.resolve()), "files": files, "rows": rows, "codes": len(bars_by_code), "generatedAt": generated_at}
