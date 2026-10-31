"""集合竞价本地归档。

上游 `0x056a selector=0` 只保留最近交易日；要长期复盘，必须在拿到当日
09:15–09:25 快照后落盘。这里只存**已经解析过的结构化点**，按
`trade_date` 分区，gzip JSONL + manifest，manifest 记录行数与规范化
JSONL 的 SHA256，读回时校验，避免拿到半截或损坏的文件。

目录：
  <data>/lake/auction/trade_date=YYYY-MM-DD/
    sh600519.jsonl.gz
    sh600519.manifest.json
"""
from __future__ import annotations

import gzip
import hashlib
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path

CODE_RE = re.compile(r"^(sh|sz|bj)\d{6}$")
DATE_RE = re.compile(r"^\d{4}-?\d{2}-?\d{2}$")
PARSER_VERSION = 1
SOURCE = "TDX 0x056a selector=0"


class AuctionArchiveError(ValueError):
    """归档参数/内容不合法。"""


def normalize_code(code: str) -> str:
    text = str(code).strip().lower()
    if not CODE_RE.fullmatch(text):
        raise AuctionArchiveError("竞价归档只支持 sh/sz/bj + 6 位数字代码")
    return text


def normalize_date(value: str) -> str:
    text = str(value).strip().replace("/", "-")
    if not DATE_RE.fullmatch(text):
        raise AuctionArchiveError("竞价日期必须是 YYYY-MM-DD 或 YYYYMMDD")
    compact = text.replace("-", "")
    try:
        parsed = datetime.strptime(compact, "%Y%m%d")
    except ValueError as error:
        raise AuctionArchiveError(f"竞价日期不合法：{value}") from error
    return parsed.strftime("%Y-%m-%d")


def _canonical_jsonl(points: list[dict]) -> str:
    return "".join(
        json.dumps(point, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n"
        for point in points
    )


def _sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def write_auction_archive(
    root: Path,
    code: str,
    trade_date: str,
    points: list[dict],
    generated_at: str | None = None,
) -> dict:
    """原子写入一只股票的竞价点；同日期重复写入会覆盖为最新一版。"""
    normalized_code = normalize_code(code)
    normalized_date = normalize_date(trade_date)
    if not points:
        raise AuctionArchiveError("竞价数据为空，不能归档")
    for point in points:
        if not isinstance(point, dict) or "time" not in point or "price" not in point:
            raise AuctionArchiveError("竞价点缺少 time/price 字段")
    target_dir = Path(root) / f"trade_date={normalized_date}"
    target_dir.mkdir(parents=True, exist_ok=True)
    payload = _canonical_jsonl(points)
    digest = _sha256(payload)
    stamp = generated_at or datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")
    data_path = target_dir / f"{normalized_code}.jsonl.gz"
    manifest_path = target_dir / f"{normalized_code}.manifest.json"
    data_tmp = target_dir / f".{normalized_code}.jsonl.gz.part"
    manifest_tmp = target_dir / f".{normalized_code}.manifest.json.part"

    with gzip.open(data_tmp, "wt", encoding="utf-8") as handle:
        handle.write(payload)
    manifest = {
        "source": SOURCE,
        "code": normalized_code,
        "tradeDate": normalized_date,
        "generatedAt": stamp,
        "rows": len(points),
        "parserVersion": PARSER_VERSION,
        "sha256": digest,
        "bytes": len(payload.encode("utf-8")),
        "file": data_path.name,
        "schema": "stocklens.auction.points.v1",
    }
    manifest_tmp.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    os.replace(data_tmp, data_path)
    os.replace(manifest_tmp, manifest_path)
    return {
        "code": normalized_code,
        "tradeDate": normalized_date,
        "rows": len(points),
        "dir": str(target_dir.resolve()),
        "sha256": digest,
        "generatedAt": stamp,
        "source": "archive",
        "found": True,
    }


def read_auction_archive(root: Path, code: str, trade_date: str) -> dict:
    """读取并校验归档；不存在时抛 FileNotFoundError，校验失败抛 AuctionArchiveError。"""
    normalized_code = normalize_code(code)
    normalized_date = normalize_date(trade_date)
    target_dir = Path(root) / f"trade_date={normalized_date}"
    data_path = target_dir / f"{normalized_code}.jsonl.gz"
    manifest_path = target_dir / f"{normalized_code}.manifest.json"
    if not data_path.is_file() or not manifest_path.is_file():
        raise FileNotFoundError(f"{normalized_code} {normalized_date} 没有本地竞价归档")
    try:
        manifest = json.loads(manifest_path.read_text("utf-8"))
    except (OSError, ValueError) as error:
        raise AuctionArchiveError(f"竞价归档 manifest 读取失败：{error}") from error
    if manifest.get("code") != normalized_code or manifest.get("tradeDate") != normalized_date:
        raise AuctionArchiveError("竞价归档 manifest 与请求代码/日期不一致")
    try:
        with gzip.open(data_path, "rt", encoding="utf-8") as handle:
            payload = handle.read()
    except (OSError, UnicodeDecodeError) as error:
        raise AuctionArchiveError(f"竞价归档数据读取失败：{error}") from error
    if _sha256(payload) != manifest.get("sha256"):
        raise AuctionArchiveError("竞价归档 SHA256 校验失败")
    points = []
    for line in payload.splitlines():
        if not line.strip():
            continue
        try:
            point = json.loads(line)
        except ValueError as error:
            raise AuctionArchiveError(f"竞价归档 JSONL 损坏：{error}") from error
        if not isinstance(point, dict):
            raise AuctionArchiveError("竞价归档点不是对象")
        points.append(point)
    if len(points) != int(manifest.get("rows") or 0):
        raise AuctionArchiveError("竞价归档行数与 manifest 不一致")
    return {
        "code": normalized_code,
        "tradeDate": normalized_date,
        "points": points,
        "rows": len(points),
        "dir": str(target_dir.resolve()),
        "sha256": manifest.get("sha256"),
        "generatedAt": manifest.get("generatedAt"),
        "source": "archive",
        "found": True,
        "manifest": manifest,
    }


def list_auction_archives(root: Path, limit: int = 50) -> list[dict]:
    """列出已归档的股票/日期，按日期和代码倒序。"""
    directory = Path(root)
    if not directory.is_dir():
        return []
    items: list[dict] = []
    for target_dir in directory.glob("trade_date=*"):
        if not target_dir.is_dir():
            continue
        for manifest_path in target_dir.glob("*.manifest.json"):
            try:
                manifest = json.loads(manifest_path.read_text("utf-8"))
            except (OSError, ValueError):
                continue
            data_path = target_dir / str(manifest.get("file") or "")
            if not data_path.is_file():
                continue
            items.append(
                {
                    "code": manifest.get("code"),
                    "tradeDate": manifest.get("tradeDate"),
                    "rows": int(manifest.get("rows") or 0),
                    "bytes": data_path.stat().st_size,
                    "sha256": manifest.get("sha256"),
                    "generatedAt": manifest.get("generatedAt"),
                    "dir": str(target_dir.resolve()),
                }
            )
    items.sort(key=lambda item: (str(item["tradeDate"]), str(item["code"])), reverse=True)
    return items[: max(1, min(500, int(limit)))]
