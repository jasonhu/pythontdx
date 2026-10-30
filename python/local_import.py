"""把本地通达信行情文件导入数据湖。

原始文件按 sha256 复制到 raw/（不覆盖）；规范化层写 JSONL.gz + SQLite；
同一 code/date 以新导入为准，重复导入不会产生重复行。
"""
from __future__ import annotations

import gzip
import hashlib
import json
import shutil
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from tdx_local import read_local_file

SCHEMA_VERSION = 1


def _safe_code(path: Path, fallback: str) -> str:
    stem = path.stem.lower()
    if len(stem) >= 8 and stem[:2] in {"sh", "sz", "bj"} and stem[2:].isdigit():
        return stem[:8]
    return "".join(ch for ch in stem if ch.isalnum())[:16] or fallback


def import_local_file(path: str, root: Path) -> dict:
    file = Path(path).expanduser()
    parsed = read_local_file(str(file), 0)
    code = _safe_code(file, "local")
    digest = hashlib.sha256(file.read_bytes()).hexdigest()
    raw_dir = root / "raw" / "local" / digest[:16]
    raw_dir.mkdir(parents=True, exist_ok=True)
    raw_target = raw_dir / file.name
    if not raw_target.exists():
        shutil.copy2(file, raw_target)

    normalized = root / "normalized" / "local"
    normalized.mkdir(parents=True, exist_ok=True)
    jsonl_path = normalized / f"{code}.jsonl.gz"
    records: dict[str, dict] = {}
    if jsonl_path.exists():
        with gzip.open(jsonl_path, "rt", encoding="utf-8") as handle:
            for line in handle:
                if not line.strip():
                    continue
                row = json.loads(line)
                records[str(row["date"])] = row
    for bar in parsed["bars"]:
        records[str(bar["date"])] = {
            "code": code,
            "date": bar["date"],
            "open": bar["open"],
            "high": bar["high"],
            "low": bar["low"],
            "close": bar["close"],
            "amount": bar.get("amount", 0),
            "volume": bar.get("volume", 0),
        }

    temporary = jsonl_path.with_suffix(".tmp")
    with gzip.open(temporary, "wt", encoding="utf-8") as handle:
        for date in sorted(records):
            handle.write(json.dumps(records[date], ensure_ascii=False, separators=(",", ":")) + "\n")
    temporary.replace(jsonl_path)

    database = normalized / "local_bars.db"
    connection = sqlite3.connect(database)
    try:
        connection.execute(
            "CREATE TABLE IF NOT EXISTS bars ("
            "code TEXT NOT NULL, date TEXT NOT NULL, open REAL, high REAL, low REAL, close REAL, "
            "amount REAL, volume REAL, source_sha TEXT, imported_at TEXT, PRIMARY KEY(code, date))"
        )
        now = datetime.now(timezone.utc).isoformat()
        connection.executemany(
            "INSERT OR REPLACE INTO bars(code,date,open,high,low,close,amount,volume,source_sha,imported_at) "
            "VALUES(?,?,?,?,?,?,?,?,?,?)",
            [
                (
                    row["code"],
                    row["date"],
                    row["open"],
                    row["high"],
                    row["low"],
                    row["close"],
                    row["amount"],
                    row["volume"],
                    digest,
                    now,
                )
                for row in records.values()
            ],
        )
        connection.commit()
    finally:
        connection.close()

    manifest_path = normalized / "manifest.json"
    manifest = {"schemaVersion": SCHEMA_VERSION, "imports": []}
    if manifest_path.exists():
        try:
            manifest = json.loads(manifest_path.read_text("utf-8"))
        except json.JSONDecodeError:
            pass
    manifest["schemaVersion"] = SCHEMA_VERSION
    manifest.setdefault("imports", []).append(
        {
            "code": code,
            "source": str(file.resolve()),
            "sha256": digest,
            "rows": len(parsed["bars"]),
            "totalRows": len(records),
            "raw": str(raw_target),
            "jsonl": str(jsonl_path),
            "at": datetime.now(timezone.utc).isoformat(),
        }
    )
    manifest["imports"] = manifest["imports"][-100:]
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), "utf-8")

    return {
        "code": code,
        "rows": len(parsed["bars"]),
        "totalRows": len(records),
        "sha256": digest,
        "rawPath": str(raw_target),
        "jsonlPath": str(jsonl_path),
        "database": str(database),
        "manifest": str(manifest_path),
    }
