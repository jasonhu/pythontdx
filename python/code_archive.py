"""按「代码 + 交易日」分片的快照归档：一个代码一个文件，互不覆盖。

为什么需要它：`protocol_archive.write_dataset_archive` 是「每个 dataset 每个
交易日只有一份文件」的模型，适合全市场一次性快照（财务、涨跌停表）。但分时、
买卖力道、小走势这类**每只股票一份**的当日快照，如果都往同一个文件里写，
第一次写入后 manifest 就固定了，第二只股票会被 `skipped` 直接丢掉——历史
上确实只保存了当天第一只股票。这里改成：

    lake/today_minute/
      trade_date=2026-11-04/
        sh600000.jsonl.gz
        sh600000.manifest.json
        sz000001.jsonl.gz
        sz000001.manifest.json

规则与其它归档一致：

* 原始行保留、manifest 记录来源/行数/SHA256/文件列表；
* 同一个 key 同一天已有**校验通过**的归档时跳过，保留第一版；
* 只有 manifest 存在但数据缺失/SHA 不匹配（损坏副本）才允许重写；
* 写入先落 `.part` 再 `os.replace`，中断不会留下半个文件。
"""
from __future__ import annotations

import csv
import gzip
import hashlib
import json
import os
import re
import threading
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable

KEY_RE = re.compile(r"^[a-z0-9][a-z0-9_.-]{0,63}$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


class CodeArchiveError(ValueError):
    """代码归档参数或内容不合法。"""


def normalize_key(key: str) -> str:
    text = str(key or "").strip().lower()
    if not KEY_RE.fullmatch(text):
        raise CodeArchiveError("归档 key 只允许小写字母/数字/._-，长度 1~64")
    return text


def normalize_date(trade_date: str) -> str:
    text = str(trade_date or "").strip()
    if not DATE_RE.fullmatch(text):
        raise CodeArchiveError("trade_date 必须是 YYYY-MM-DD")
    return text


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _paths(root: Path, key: str, trade_date: str) -> tuple[Path, Path, Path]:
    directory = Path(root) / f"trade_date={trade_date}"
    return (
        directory,
        directory / f"{key}.jsonl.gz",
        directory / f"{key}.manifest.json",
    )


def _existing_ok(
    data_path: Path, manifest_path: Path, dataset: str | None = None
) -> dict | None:
    """已有归档校验通过则返回 manifest，否则返回 None（交给调用方重写）。"""
    if not data_path.is_file() or not manifest_path.is_file():
        return None
    try:
        manifest = json.loads(manifest_path.read_text("utf-8"))
        if dataset is not None and str(manifest.get("dataset") or "") != dataset:
            return None
        if _sha256(data_path) != manifest.get("sha256"):
            return None
        if int(manifest.get("rows") or 0) <= 0:
            return None
        listed = [manifest_path.parent / str(name) for name in manifest.get("files") or []]
        if listed and not all(path.is_file() for path in listed):
            return None
        return manifest
    except (OSError, ValueError):
        return None


def write_code_archive(
    root: Path,
    dataset: str,
    key: str,
    rows: Iterable[dict[str, Any]],
    *,
    source: str,
    trade_date: str,
    fields: list[str] | None = None,
    generated_at: str | None = None,
) -> dict:
    """写一个 (dataset, key, trade_date) 分片；已有有效归档保留第一份。"""
    normalized_key = normalize_key(key)
    day = normalize_date(trade_date)
    directory, data_path, manifest_path = _paths(root, normalized_key, day)
    existing = _existing_ok(data_path, manifest_path, dataset)
    if existing is not None:
        return {
            "dataset": dataset,
            "key": normalized_key,
            "tradeDate": day,
            "dir": str(directory.resolve()),
            "rows": int(existing.get("rows") or 0),
            "sha256": str(existing.get("sha256") or ""),
            "generatedAt": str(existing.get("generatedAt") or ""),
            "skipped": True,
        }

    materialized = [dict(row) for row in rows]
    if not materialized:
        raise CodeArchiveError("归档内容为空，拒绝写入")
    directory.mkdir(parents=True, exist_ok=True)
    temporary = data_path.with_name(
        f"{data_path.name}.{os.getpid()}.{threading.get_ident()}.part"
    )
    with gzip.open(temporary, "wt", encoding="utf-8") as handle:
        for row in materialized:
            handle.write(
                json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n"
            )
    os.replace(temporary, data_path)

    files = [data_path.name]
    if fields:
        csv_path = directory / f"{normalized_key}.{dataset}.csv"
        temporary_csv = csv_path.with_name(
            f"{csv_path.name}.{os.getpid()}.{threading.get_ident()}.part"
        )
        with temporary_csv.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.writer(handle)
            writer.writerow(fields)
            for row in materialized:
                writer.writerow([row.get(field, "") for field in fields])
        os.replace(temporary_csv, csv_path)
        files.append(csv_path.name)

    digest = _sha256(data_path)
    generated = generated_at or datetime.now().astimezone().isoformat(timespec="seconds")
    manifest = {
        "schema": f"pythontdx.{dataset}.v1",
        "dataset": dataset,
        "key": normalized_key,
        "tradeDate": day,
        "source": source,
        "generatedAt": generated,
        "rows": len(materialized),
        "sha256": digest,
        "files": files,
    }
    temporary_manifest = manifest_path.with_name(
        f"{manifest_path.name}.{os.getpid()}.{threading.get_ident()}.part"
    )
    temporary_manifest.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    os.replace(temporary_manifest, manifest_path)
    return {
        "dataset": dataset,
        "key": normalized_key,
        "tradeDate": day,
        "dir": str(directory.resolve()),
        "rows": len(materialized),
        "sha256": digest,
        "generatedAt": generated,
        "skipped": False,
    }


def list_code_archives(root: Path, limit: int = 50) -> list[dict]:
    """列出按代码分片的归档；按交易日、生成时间倒序。"""
    directory = Path(root)
    if not directory.is_dir():
        return []
    items: list[dict] = []
    for manifest_path in directory.glob("trade_date=*/*.manifest.json"):
        try:
            manifest = json.loads(manifest_path.read_text("utf-8"))
        except (OSError, ValueError):
            continue
        files = [manifest_path.parent / str(name) for name in manifest.get("files") or []]
        items.append(
            {
                **manifest,
                "dir": str(manifest_path.parent.resolve()),
                "size": sum(path.stat().st_size for path in files if path.is_file()),
            }
        )
    items.sort(
        key=lambda item: (str(item.get("tradeDate") or ""), str(item.get("generatedAt") or "")),
        reverse=True,
    )
    return items[: max(1, min(1000, int(limit)))]


def count_code_archives(root: Path, trade_date: str | None = None) -> int:
    """统计按代码分片的归档数量；指定日期时只数该日分区。"""
    directory = Path(root)
    if not directory.is_dir():
        return 0
    pattern = (
        f"trade_date={trade_date}/*.manifest.json"
        if trade_date
        else "trade_date=*/*.manifest.json"
    )
    return sum(1 for _ in directory.glob(pattern))


def read_code_archive(
    root: Path, key: str, trade_date: str, dataset: str | None = None
) -> dict:
    """读取一个分片并做 SHA256 校验；损坏时抛 CodeArchiveError。"""
    normalized_key = normalize_key(key)
    day = normalize_date(trade_date)
    directory, data_path, manifest_path = _paths(root, normalized_key, day)
    if not manifest_path.is_file() or not data_path.is_file():
        raise FileNotFoundError(f"归档不存在：{normalized_key} {day}")
    manifest = json.loads(manifest_path.read_text("utf-8"))
    if dataset and str(manifest.get("dataset") or "") != dataset:
        raise CodeArchiveError("归档 dataset 不匹配")
    if _sha256(data_path) != manifest.get("sha256"):
        raise CodeArchiveError("归档 SHA256 校验失败，副本可能损坏")
    rows: list[dict] = []
    with gzip.open(data_path, "rt", encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                rows.append(json.loads(line))
    return {"manifest": manifest, "rows": rows, "count": len(rows)}
