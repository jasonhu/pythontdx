#!/usr/bin/env python3
"""收盘后归档全市场 A 股快照；可挂 cron：

    5 15 * * 1-5  cd /path/to/stocklens && python3 scripts/archive-snapshot.py

只写本地数据湖，不交易、不访问付费数据。
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "python"))

from tdx_bridge import Bridge, TdxError  # noqa: E402


def main() -> int:
    bridge = Bridge()
    try:
        result = bridge.archive_snapshot()
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except (TdxError, OSError, ValueError) as error:
        print(json.dumps({"ok": False, "error": str(error)}, ensure_ascii=False), file=sys.stderr)
        return 1
    finally:
        bridge.close()


if __name__ == "__main__":
    raise SystemExit(main())
