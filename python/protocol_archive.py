"""通用协议数据归档：JSONL.gz + 可选 CSV + manifest + SHA256。

为什么单独一个模块：eltdx 的协议补齐过程中，很多「一次性快照」类数据
（特殊涨跌停表、财务快照、GBBQ 等）不需要各自发明一套文件格式。
统一按 trade_date 分区、保留原始行、写 manifest，后续 DuckDB/Pandas 可直接读。
"""
from __future__ import annotations

import csv
import gzip
import hashlib
import json
import os
import threading
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


_PROCESS_LOCKS: dict[str, threading.Lock] = {}
_PROCESS_LOCKS_GUARD = threading.Lock()


def _thread_lock(directory: Path) -> threading.Lock:
    key = str(directory.resolve())
    with _PROCESS_LOCKS_GUARD:
        return _PROCESS_LOCKS.setdefault(key, threading.Lock())


@contextmanager
def _partition_lock(directory: Path):
    """同一 trade_date 分区的跨线程/跨进程写锁（Windows/Unix 都支持）。"""
    # 先拿进程内锁：Windows msvcrt 对同进程另一线程不会排队，直接 EDEADLOCK。
    local = _thread_lock(directory)
    local.acquire()
    handle = None
    try:
        lock_path = directory / ".write.lock"
        handle = lock_path.open("a+b")
        if os.name == "nt":
            import msvcrt

            handle.seek(0)
            msvcrt.locking(handle.fileno(), msvcrt.LK_LOCK, 1)
        else:
            import fcntl

            fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
        yield
    finally:
        try:
            if handle is not None:
                try:
                    if os.name == "nt":
                        import msvcrt

                        handle.seek(0)
                        msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
                    else:
                        import fcntl

                        fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
                finally:
                    handle.close()
        finally:
            local.release()


def write_dataset_archive(
    root: Path,
    dataset: str,
    rows: Iterable[dict[str, Any]],
    *,
    source: str,
    trade_date: str,
    fields: list[str] | None = None,
    generated_at: str | None = None,
) -> dict:
    directory = Path(root) / f"trade_date={trade_date}"
    directory.mkdir(parents=True, exist_ok=True)
    with _partition_lock(directory):
        return _write_dataset_archive(
            root,
            dataset,
            rows,
            source=source,
            trade_date=trade_date,
            fields=fields,
            generated_at=generated_at,
        )


def _write_dataset_archive(
    root: Path,
    dataset: str,
    rows: Iterable[dict[str, Any]],
    *,
    source: str,
    trade_date: str,
    fields: list[str] | None = None,
    generated_at: str | None = None,
) -> dict:
    """写一个 trade_date 分区；已有同分区且校验通过时保留第一份。

    不能只看 manifest 是否存在：文件缺失/SHA 不匹配属于「损坏副本」，
    规则 12 允许重写；否则一次中断留下的 manifest 会让该分区永久无法修复。
    """
    directory = Path(root) / f"trade_date={trade_date}"
    manifest_path = directory / "manifest.json"
    if manifest_path.is_file():
        try:
            manifest = json.loads(manifest_path.read_text("utf-8"))
        except (OSError, ValueError):
            manifest = {}
        files = [directory / str(name) for name in manifest.get("files") or []]
        jsonl = next((path for path in files if path.name.endswith(".jsonl.gz")), None)
        valid = (
            bool(files)
            and all(path.is_file() for path in files)
            and jsonl is not None
            and _sha256(jsonl) == manifest.get("sha256")
        )
        if valid:
            return {
                "dir": str(directory.resolve()),
                "dataset": dataset,
                "tradeDate": trade_date,
                "rows": int(manifest.get("rows") or 0),
                "sha256": str(manifest.get("sha256") or ""),
                "generatedAt": str(manifest.get("generatedAt") or ""),
                "skipped": True,
            }

    directory.mkdir(parents=True, exist_ok=True)
    materialized = [dict(row) for row in rows] if fields else None
    jsonl_path = directory / f"{dataset}.jsonl.gz"
    temporary = jsonl_path.with_name(
        f"{jsonl_path.name}.{os.getpid()}.{threading.get_ident()}.part"
    )
    count = 0
    with gzip.open(temporary, "wt", encoding="utf-8") as handle:
        source_rows = materialized if materialized is not None else rows
        for row in source_rows:
            handle.write(
                json.dumps(dict(row), ensure_ascii=False, separators=(",", ":")) + chr(10)
            )
            count += 1
    os.replace(temporary, jsonl_path)
    files = [jsonl_path.name]
    if fields and materialized is not None:
        csv_path = directory / f"{dataset}.csv"
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
    digest = _sha256(jsonl_path)
    generated = generated_at or datetime.now().astimezone().isoformat(timespec="seconds")
    manifest = {
        "schema": f"pythontdx.{dataset}.v1",
        "source": source,
        "tradeDate": trade_date,
        "generatedAt": generated,
        "rows": count,
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
        "dir": str(directory.resolve()),
        "dataset": dataset,
        "tradeDate": trade_date,
        "rows": count,
        "sha256": digest,
        "generatedAt": generated,
        "skipped": False,
    }


def list_dataset_archives(root: Path, limit: int = 50) -> list[dict]:
    directory = Path(root)
    if not directory.is_dir():
        return []
    items: list[dict] = []
    for path in sorted(directory.glob("trade_date=*/manifest.json"), reverse=True):
        try:
            manifest = json.loads(path.read_text("utf-8"))
        except (OSError, ValueError):
            continue
        files = [path.parent / name for name in manifest.get("files") or []]
        items.append(
            {
                **manifest,
                "dir": str(path.parent.resolve()),
                "size": sum(item.stat().st_size for item in files if item.is_file()),
            }
        )
    return items[: max(1, min(100, int(limit)))]


def read_dataset_archive(root: Path, dataset: str, trade_date: str) -> dict:
    """读取一个 trade_date 分区的 JSONL；dataset/date 只允许安全字符。"""
    import re

    name = str(dataset or "").strip()
    date = str(trade_date or "").strip()
    if not re.fullmatch(r"[a-z0-9_]+", name):
        raise ValueError("dataset 不合法")
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date):
        raise ValueError("date 必须是 YYYY-MM-DD")
    directory = Path(root) / f"trade_date={date}"
    manifest_path = directory / "manifest.json"
    if not manifest_path.is_file():
        raise FileNotFoundError(f"归档不存在：{name} {date}")
    with _partition_lock(directory):
        manifest = json.loads(manifest_path.read_text("utf-8"))
        jsonl = directory / f"{name}.jsonl.gz"
        if not jsonl.is_file():
            raise FileNotFoundError(f"归档数据缺失：{jsonl.name}")
        if manifest.get("sha256") and _sha256(jsonl) != manifest.get("sha256"):
            raise ValueError(f"归档校验失败：{name} {date}")
        rows: list[dict] = []
        with gzip.open(jsonl, "rt", encoding="utf-8") as handle:
            for line in handle:
                if line.strip():
                    rows.append(json.loads(line))
        return {"manifest": manifest, "rows": rows, "count": len(rows)}

