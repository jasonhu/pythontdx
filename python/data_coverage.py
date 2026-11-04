"""本地数据覆盖清单：只读扫描，不写入、不删除。"""
from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path


def _scan(root: Path, name: str, patterns: tuple[str, ...], partition: str) -> dict:
    files: list[Path] = []
    for pattern in patterns:
        files.extend(path for path in root.glob(pattern) if path.is_file())
    files = sorted(set(files))
    total = 0
    dates: list[str] = []
    for path in files:
        try:
            total += path.stat().st_size
        except OSError:
            continue
        for part in path.parts:
            if part.startswith(f"{partition}="):
                dates.append(part.split("=", 1)[1])
                break
    return {
        "name": name,
        "files": len(files),
        "bytes": total,
        "oldest": min(dates) if dates else None,
        "newest": max(dates) if dates else None,
        "status": "ok" if files else "empty",
    }


def collect_data_coverage(root: Path) -> dict:
    base = Path(root)
    datasets = [
        _scan(base, "klines", ("cache/klines/*.parquet",), "trade_date"),
        _scan(base, "kline_1m", ("lake/kline_1m/**/*.parquet",), "trade_date"),
        _scan(base, "ticks", ("lake/ticks/**/*.parquet",), "trade_date"),
        _scan(base, "auction", ("lake/auction/**/*.jsonl.gz",), "trade_date"),
        _scan(base, "money_flow", ("lake/money_flow/**/*.parquet",), "trade_date"),
        _scan(base, "f10_pit", ("lake/f10_pit/**/*.parquet",), "snapshot_date"),
        _scan(base, "f10_detail", ("lake/f10_detail/**/*.jsonl.gz",), "trade_date"),
        _scan(base, "f10_market", ("lake/f10_market/**/*.jsonl.gz",), "trade_date"),
        _scan(base, "market_news", ("lake/market_news/**/*.jsonl.gz",), "trade_date"),
        _scan(base, "channel_news", ("lake/channel_news/**/*.jsonl.gz",), "trade_date"),
        _scan(base, "server_files", ("lake/server_files/**/catalog.json",), "snapshot_date"),
        _scan(base, "server_meta", ("lake/server_meta/**/*.jsonl.gz",), "trade_date"),
        _scan(base, "quotes", ("lake/quotes/**/*",), "trade_date"),
        _scan(base, "category_quotes", ("lake/category_quotes/**/*.jsonl.gz",), "trade_date"),
        _scan(base, "finance", ("lake/finance/**/*.jsonl.gz",), "trade_date"),
        _scan(base, "finance_history", ("lake/finance_history/**/*.jsonl.gz",), "trade_date"),
        _scan(base, "gbbq", ("lake/gbbq/**/*.jsonl.gz",), "trade_date"),
        _scan(base, "blocks", ("lake/blocks/**/*.jsonl.gz",), "trade_date"),
        _scan(base, "limit_ladder", ("lake/limit_ladder/**/*.jsonl.gz",), "trade_date"),
        _scan(base, "today_minute", ("lake/today_minute/**/*.jsonl.gz",), "trade_date"),
        _scan(base, "minute_aux", ("lake/minute_aux/**/*.jsonl.gz",), "trade_date"),
        _scan(base, "sparkline", ("lake/sparkline/**/*.jsonl.gz",), "trade_date"),
        _scan(base, "recent_minute", ("lake/recent_minute/**/*.jsonl.gz",), "trade_date"),
        _scan(base, "history_minute", ("lake/history_minute/**/*.jsonl.gz",), "trade_date"),
        _scan(base, "volume_profile", ("lake/volume_profile/**/*.jsonl.gz",), "trade_date"),
        _scan(base, "top_board", ("lake/top_board/**/*.jsonl.gz",), "trade_date"),
        _scan(base, "unusual", ("lake/unusual/**/*.jsonl.gz",), "trade_date"),
        _scan(base, "corporate", ("lake/corporate/**/*.jsonl.gz",), "trade_date"),
        _scan(base, "special_limits", ("lake/special_limits/**/*.jsonl.gz",), "trade_date"),
        _scan(base, "delisted", ("lake/delisted/*.parquet",), "trade_date"),
        _scan(base, "normalized", ("normalized/**/*.jsonl.gz",), "trade_date"),
        _scan(base, "raw", ("raw/**/*",), "snapshot_date"),
    ]
    periods: dict[str, int] = {}
    first_dates: list[str] = []
    last_dates: list[str] = []
    for path in (base / "cache" / "klines").glob("*.parquet"):
        parts = path.stem.split("_")
        if len(parts) >= 2:
            periods[parts[1]] = periods.get(parts[1], 0) + 1
    for path in (base / "cache" / "klines").glob("*.parquet.manifest.json"):
        try:
            manifest = json.loads(path.read_text("utf-8"))
        except (OSError, ValueError):
            continue
        if manifest.get("firstDate"):
            first_dates.append(str(manifest["firstDate"]))
        if manifest.get("lastDate"):
            last_dates.append(str(manifest["lastDate"]))
    kline = next((item for item in datasets if item["name"] == "klines"), None)
    if kline is not None:
        kline["periods"] = dict(sorted(periods.items()))
        if first_dates:
            kline["oldest"] = min(first_dates)
        if last_dates:
            kline["newest"] = max(last_dates)
    # 1m 按「最后交易日」分目录，目录区间只有最后一天；真实区间在 manifest
    # 的 firstDate/lastDate 里。不读这一层，UI 会误显示成只有今天。
    kline_1m = next((item for item in datasets if item["name"] == "kline_1m"), None)
    if kline_1m is not None:
        first_1m: list[str] = []
        last_1m: list[str] = []
        for path in (base / "lake" / "kline_1m").glob("**/*.parquet.manifest.json"):
            try:
                manifest = json.loads(path.read_text("utf-8"))
            except (OSError, ValueError):
                continue
            if manifest.get("firstDate"):
                first_1m.append(str(manifest["firstDate"]))
            if manifest.get("lastDate"):
                last_1m.append(str(manifest["lastDate"]))
        if first_1m:
            kline_1m["oldest"] = min(first_1m)
        if last_1m:
            kline_1m["newest"] = max(last_1m)
    return {
        "generatedAt": datetime.now().astimezone().isoformat(timespec="seconds"),
        "root": str(base.resolve()),
        "datasets": datasets,
        "totalFiles": sum(item["files"] for item in datasets),
        "totalBytes": sum(item["bytes"] for item in datasets),
    }
