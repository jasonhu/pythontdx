"""0x0547 盘中语义探针：记录不同游标/连续请求的响应差异。

只在交易时段运行；结果写到 STOCKLENS_DATA_DIR/lake/probes/。
不判断“有没有推送”，只记录可复核的 JSONL 证据。
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "python"))

import tdx_bridge as tdx  # noqa: E402


def digest(value: object) -> str:
    return hashlib.sha256(
        json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--code", default="sh600519")
    parser.add_argument("--seconds", type=int, default=60)
    parser.add_argument("--interval", type=float, default=2.0)
    args = parser.parse_args()
    code = args.code
    bridge = tdx.Bridge()
    target = tdx.stocklens_data_dir() / "lake" / "probes"
    target.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().astimezone().strftime("%Y%m%d-%H%M%S")
    path = target / f"0x0547-{stamp}.jsonl"
    started = time.time()
    records = 0
    try:
        with path.open("w", encoding="utf-8") as stream:
            for mode, cursor in (
                ("zero", 0),
                ("one", 1),
                ("max", 0xFFFFFFFF),
                ("timestamp", int(time.time() * 1000) & 0xFFFFFFFF),
            ):
                for round_index in range(3):
                    received = time.time()
                    try:
                        result = bridge.refresh_quotes([code], {code: cursor})
                        record = {
                            "at": datetime.now().astimezone().isoformat(timespec="seconds"),
                            "elapsed": round(received - started, 3),
                            "mode": mode,
                            "cursor": cursor,
                            "round": round_index,
                            "count": len(result),
                            "hash": digest(result),
                            "sample": result[0] if result else None,
                        }
                    except Exception as error:  # noqa: BLE001
                        record = {
                            "at": datetime.now().astimezone().isoformat(timespec="seconds"),
                            "mode": mode,
                            "cursor": cursor,
                            "round": round_index,
                            "error": str(error),
                        }
                    stream.write(json.dumps(record, ensure_ascii=False) + "\n")
                    stream.flush()
                    records += 1
                    time.sleep(0.25)
            while time.time() - started < args.seconds:
                received = time.time()
                try:
                    result = bridge.refresh_quotes([code], {code: 0})
                    record = {
                        "at": datetime.now().astimezone().isoformat(timespec="seconds"),
                        "elapsed": round(received - started, 3),
                        "mode": "loop-zero",
                        "cursor": 0,
                        "count": len(result),
                        "hash": digest(result),
                        "sample": result[0] if result else None,
                    }
                except Exception as error:  # noqa: BLE001
                    record = {
                        "at": datetime.now().astimezone().isoformat(timespec="seconds"),
                        "mode": "loop-zero",
                        "error": str(error),
                    }
                stream.write(json.dumps(record, ensure_ascii=False) + "\n")
                stream.flush()
                records += 1
                time.sleep(max(0.2, args.interval))
    finally:
        bridge.close()
    print(json.dumps({"path": str(path), "records": records}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
