"""本地归档 manifest 校验：文件存在 + SHA256 + 基本行数/结构。"""
from __future__ import annotations

import json
from pathlib import Path

from auction_archive import read_auction_archive
from kline_manifest import backfill_kline_manifests, verify_kline_manifests
from parquet_store import file_sha256


def _verify(root: Path, name: str, pattern: str, limit: int = 100_000) -> dict:
    checked = 0
    failed = 0
    details: list[dict] = []
    for manifest_path in sorted(Path(root).glob(pattern))[:limit]:
        checked += 1
        try:
            manifest = json.loads(manifest_path.read_text("utf-8"))
            file_name = str(manifest.get("file") or "")
            data_path = manifest_path.parent / file_name
            if not data_path.is_file():
                raise ValueError("数据文件缺失")
            digest = file_sha256(data_path)
            if digest != manifest.get("sha256"):
                raise ValueError("SHA256 不匹配")
            rows = manifest.get("rows")
            if rows is not None and int(rows) < 0:
                raise ValueError("rows 非法")
        except Exception as error:  # noqa: BLE001
            failed += 1
            details.append({"manifest": str(manifest_path), "error": str(error)})
    return {"name": name, "checked": checked, "failed": failed, "details": details[:10]}


def _verify_generic(root: Path, name: str, pattern: str | tuple[str, ...]) -> dict:
    """校验 protocol_archive 的 files[] + JSONL SHA256 格式。

    `pattern` 允许传多个：按代码分片的归档（`<key>.manifest.json`）与早期的
    整包归档（`manifest.json`）布局不同，两种都要校验。
    """
    patterns = (pattern,) if isinstance(pattern, str) else pattern
    manifests: list[Path] = []
    for item in patterns:
        manifests.extend(Path(root).glob(item))
    checked = 0
    failed = 0
    details: list[dict] = []
    for manifest_path in sorted(set(manifests))[:100_000]:
        checked += 1
        try:
            manifest = json.loads(manifest_path.read_text("utf-8"))
            files = [manifest_path.parent / str(item) for item in manifest.get("files") or []]
            if not files or not all(path.is_file() for path in files):
                raise ValueError("数据文件缺失")
            jsonl = next((path for path in files if path.name.endswith(".jsonl.gz")), None)
            if jsonl is None:
                raise ValueError("缺少 JSONL 数据文件")
            if file_sha256(jsonl) != manifest.get("sha256"):
                raise ValueError("SHA256 不匹配")
            if int(manifest.get("rows") or 0) < 0:
                raise ValueError("rows 非法")
        except Exception as error:  # noqa: BLE001
            failed += 1
            details.append({"manifest": str(manifest_path), "error": str(error)})
    return {"name": name, "checked": checked, "failed": failed, "details": details[:10]}


def _verify_auction(root: Path) -> dict:
    checked = 0
    failed = 0
    details: list[dict] = []
    for manifest_path in sorted((Path(root) / "lake" / "auction").glob("trade_date=*/*.manifest.json")):
        checked += 1
        try:
            manifest = json.loads(manifest_path.read_text("utf-8"))
            read_auction_archive(
                Path(root) / "lake" / "auction",
                str(manifest.get("code") or ""),
                str(manifest.get("tradeDate") or ""),
            )
        except Exception as error:  # noqa: BLE001
            failed += 1
            details.append({"manifest": str(manifest_path), "error": str(error)})
    return {"name": "auction", "checked": checked, "failed": failed, "details": details[:10]}


def verify_data_integrity(root: Path) -> dict:
    kline_backfill = backfill_kline_manifests(Path(root) / "cache" / "klines")
    kline_check = verify_kline_manifests(Path(root) / "cache" / "klines", limit=100_000)
    checks = [
        {"name": "klines", **kline_check},
        _verify(root, "ticks", "lake/ticks/**/*.manifest.json"),
        _verify_auction(root),
        _verify(root, "f10_pit", "lake/f10_pit/**/*.manifest.json"),
        _verify(root, "money_flow", "lake/money_flow/**/*.manifest.json"),
        _verify(root, "server_files", "lake/server_files/**/manifest.json"),
        _verify(root, "delisted", "lake/delisted/*.manifest.json"),
        _verify_generic(root, "finance", "lake/finance/**/manifest.json"),
        _verify_generic(root, "finance_history", "lake/finance_history/**/manifest.json"),
        _verify_generic(root, "gbbq", "lake/gbbq/**/manifest.json"),
        _verify_generic(root, "blocks", "lake/blocks/**/manifest.json"),
        _verify_generic(root, "limit_ladder", "lake/limit_ladder/**/manifest.json"),
        _verify_generic(root, "corporate", "lake/corporate/**/manifest.json"),
        _verify_generic(root, "special_limits", "lake/special_limits/**/manifest.json"),
        _verify_generic(root, "server_meta", ("lake/server_meta/**/manifest.json", "lake/server_meta/**/*.manifest.json")),
        _verify_generic(root, "minute_aux", ("lake/minute_aux/**/manifest.json", "lake/minute_aux/**/*.manifest.json")),
        _verify_generic(root, "sparkline", ("lake/sparkline/**/manifest.json", "lake/sparkline/**/*.manifest.json")),
        _verify_generic(root, "recent_minute", ("lake/recent_minute/**/manifest.json", "lake/recent_minute/**/*.manifest.json")),
        _verify_generic(root, "history_minute", ("lake/history_minute/**/manifest.json", "lake/history_minute/**/*.manifest.json")),
        _verify_generic(root, "today_minute", ("lake/today_minute/**/manifest.json", "lake/today_minute/**/*.manifest.json")),
        _verify_generic(root, "volume_profile", "lake/volume_profile/**/*.manifest.json"),
        _verify_generic(root, "top_board", "lake/top_board/**/*.manifest.json"),
        _verify_generic(root, "unusual", "lake/unusual/**/manifest.json"),
        _verify_generic(root, "category_quotes", ("lake/category_quotes/**/manifest.json", "lake/category_quotes/**/*.manifest.json")),
        _verify_generic(root, "market_news", ("lake/market_news/**/manifest.json", "lake/market_news/**/*.manifest.json")),
        _verify_generic(root, "channel_news", ("lake/channel_news/**/manifest.json", "lake/channel_news/**/*.manifest.json")),
        _verify_generic(root, "f10_detail", ("lake/f10_detail/**/manifest.json", "lake/f10_detail/**/*.manifest.json")),
        _verify_generic(root, "f10_market", ("lake/f10_market/**/manifest.json", "lake/f10_market/**/*.manifest.json")),
    ]
    return {
        "ok": all(item["failed"] == 0 for item in checks),
        "checks": checks,
        "klineBackfill": kline_backfill,
        "checked": sum(item.get("checked", 0) for item in checks),
        "failed": sum(item.get("failed", 0) for item in checks),
    }
