"""历史逐笔本地 Parquet 归档。

上游 `0x122F` / `0x0fc5` / `0x0fc6` 的逐笔明细在服务器上只保留有限日期，
且分页请求有延迟。这里把**已解析的结构化逐笔**按 `trade_date` + code 写成
Parquet（ZSTD），manifest 只保存元数据/行数/SHA256，不重复存数据。

目录：
  <data>/lake/ticks/trade_date=YYYY-MM-DD/
    sh600519.parquet
    sh600519.manifest.json

读历史逐笔时优先走本归档；只有没有归档时才请求上游。已存在且校验通过的
归档永不覆盖（返回 skipped），只有损坏副本才允许替换，符合永久保存规则。
"""
from __future__ import annotations

import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path

from parquet_store import (
    ParquetStoreError,
    file_sha256,
    read_ticks,
    write_ticks,
)

CODE_RE = re.compile(r"^(sh|sz|bj)\d{6}$")
DATE_RE = re.compile(r"^\d{4}-?\d{2}-?\d{2}$")
PARSER_VERSION = 1
SOURCE = "TDX 0x122F / 0x0fc5 / 0x0fc6 ticks"


class TickArchiveError(ValueError):
    """逐笔归档参数/内容不合法。"""


def normalize_code(code: str) -> str:
    text = str(code).strip().lower()
    if not CODE_RE.fullmatch(text):
        raise TickArchiveError("逐笔归档只支持 sh/sz/bj + 6 位数字代码")
    return text


def normalize_date(value: str) -> str:
    text = str(value).strip().replace("/", "-")
    if not DATE_RE.fullmatch(text):
        raise TickArchiveError("逐笔日期必须是 YYYY-MM-DD 或 YYYYMMDD")
    compact = text.replace("-", "")
    try:
        parsed = datetime.strptime(compact, "%Y%m%d")
    except ValueError as error:
        raise TickArchiveError(f"逐笔日期不合法：{value}") from error
    return parsed.strftime("%Y-%m-%d")


def write_tick_archive(
    root: Path,
    code: str,
    trade_date: str,
    ticks: list[dict],
    generated_at: str | None = None,
) -> dict:
    """原子写入一只股票的逐笔 Parquet；正常归档永久保留，只有损坏才覆盖。"""
    normalized_code = normalize_code(code)
    normalized_date = normalize_date(trade_date)
    if not ticks:
        raise TickArchiveError("逐笔数据为空，不能归档")
    for tick in ticks:
        if not isinstance(tick, dict) or "index" not in tick or "time" not in tick:
            raise TickArchiveError("逐笔记录缺少 index/time 字段")
    target_dir = Path(root) / f"trade_date={normalized_date}"
    data_path = target_dir / f"{normalized_code}.parquet"
    manifest_path = target_dir / f"{normalized_code}.manifest.json"
    if data_path.is_file() and manifest_path.is_file():
        try:
            existing = read_tick_archive(root, normalized_code, normalized_date)
            return {
                "code": existing["code"],
                "tradeDate": existing["tradeDate"],
                "rows": existing["rows"],
                "dir": existing["dir"],
                "sha256": existing["sha256"],
                "generatedAt": existing["generatedAt"],
                "source": "archive",
                "found": True,
                "skipped": True,
            }
        except TickArchiveError:
            # 只有已存在的归档损坏时才允许覆盖；正常数据永久保留。
            pass
    target_dir.mkdir(parents=True, exist_ok=True)
    stamp = generated_at or datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")
    write_ticks(data_path, normalized_code, ticks)
    digest = file_sha256(data_path)
    manifest = {
        "source": SOURCE,
        "code": normalized_code,
        "tradeDate": normalized_date,
        "generatedAt": stamp,
        "rows": len(ticks),
        "parserVersion": PARSER_VERSION,
        "sha256": digest,
        "bytes": data_path.stat().st_size,
        "file": data_path.name,
        "schema": "stocklens.ticks.v1",
        "format": "parquet-zstd",
    }
    manifest_tmp = target_dir / f".{normalized_code}.manifest.json.part"
    manifest_tmp.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    os.replace(manifest_tmp, manifest_path)
    return {
        "code": normalized_code,
        "tradeDate": normalized_date,
        "rows": len(ticks),
        "dir": str(target_dir.resolve()),
        "sha256": digest,
        "generatedAt": stamp,
        "source": "archive",
        "found": True,
    }


def read_tick_archive(root: Path, code: str, trade_date: str) -> dict:
    """读取并校验 Parquet 归档；不存在抛 FileNotFoundError，校验失败抛 TickArchiveError。"""
    normalized_code = normalize_code(code)
    normalized_date = normalize_date(trade_date)
    target_dir = Path(root) / f"trade_date={normalized_date}"
    data_path = target_dir / f"{normalized_code}.parquet"
    manifest_path = target_dir / f"{normalized_code}.manifest.json"
    if not data_path.is_file() or not manifest_path.is_file():
        raise FileNotFoundError(f"{normalized_code} {normalized_date} 没有本地逐笔归档")
    try:
        manifest = json.loads(manifest_path.read_text("utf-8"))
    except (OSError, ValueError) as error:
        raise TickArchiveError(f"逐笔归档 manifest 读取失败：{error}") from error
    if manifest.get("code") != normalized_code or manifest.get("tradeDate") != normalized_date:
        raise TickArchiveError("逐笔归档 manifest 与请求代码/日期不一致")
    if file_sha256(data_path) != manifest.get("sha256"):
        raise TickArchiveError("逐笔归档 SHA256 校验失败")
    try:
        result = read_ticks(data_path)
    except ParquetStoreError as error:
        raise TickArchiveError(f"逐笔归档 Parquet 读取失败：{error}") from error
    ticks = result["ticks"]
    if len(ticks) != int(manifest.get("rows") or 0):
        raise TickArchiveError("逐笔归档行数与 manifest 不一致")
    return {
        "code": normalized_code,
        "tradeDate": normalized_date,
        "ticks": ticks,
        "rows": len(ticks),
        "dir": str(target_dir.resolve()),
        "sha256": manifest.get("sha256"),
        "generatedAt": manifest.get("generatedAt"),
        "source": "archive",
        "found": True,
        "manifest": manifest,
    }


def list_tick_archives(root: Path, limit: int = 50) -> list[dict]:
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
