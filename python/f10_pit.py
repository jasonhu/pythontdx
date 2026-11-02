"""F10 / 财务 point-in-time 快照。

服务器只返回「当前」F10 与财务表，历史版本不会回放。这里在每次成功查询后，
把**解析后的 payload** 按 `snapshot_date + code + table` 存一份 Parquet：
  lake/f10_pit/snapshot_date=YYYY-MM-DD/<table>/<code>.parquet

同一 code/table/日期已存在且校验通过时返回 skipped，保证第一版不被覆盖；
只有损坏副本才允许重写。payload 原样保存在一列 JSON 中，因为不同 F10 表的
列结构差异很大；查询层可按需从 JSON 展开。
"""
from __future__ import annotations

import json
import os
import re
from datetime import datetime
from pathlib import Path

from parquet_store import ParquetStoreError, file_sha256
from data_paths import data_dir

CODE_RE = re.compile(r"^(sh|sz|bj)\d{6}$")
TABLE_RE = re.compile(r"[^a-zA-Z0-9_]+")
SCHEMA_VERSION = 1
SOURCE = "TDX 7709/7615 F10 snapshot"


def default_root() -> Path:
    return data_dir() / "lake" / "f10_pit"


class F10SnapshotError(ValueError):
    """快照参数/内容不合法。"""


def normalize_code(code: str) -> str:
    text = str(code).strip().lower()
    if not CODE_RE.fullmatch(text):
        raise F10SnapshotError("F10 快照只支持 sh/sz/bj + 6 位数字代码")
    return text


def normalize_table(table: str) -> str:
    text = TABLE_RE.sub("_", str(table).strip()).strip("_").lower()
    if not text:
        raise F10SnapshotError("F10 快照表名不能为空")
    return text[:80]


def _duckdb():
    try:
        import duckdb
    except ImportError as error:  # pragma: no cover
        raise F10SnapshotError(
            "未安装 duckdb；请执行 python3 -m pip install -r requirements.txt"
        ) from error
    return duckdb


def _find_report_date(value: object, depth: int = 0) -> str:
    if depth > 4:
        return ""
    if isinstance(value, dict):
        columns = value.get("columns")
        rows = value.get("rows")
        if isinstance(columns, list) and isinstance(rows, list) and rows:
            for index, column in enumerate(columns):
                if any(token in str(column) for token in ("报告期", "日期", "截止")):
                    first = rows[0]
                    if isinstance(first, list) and index < len(first):
                        candidate = str(first[index])
                        if re.search(r"\d{4}[-/]?\d{2}", candidate):
                            return candidate
        for key in ("报告期", "reportDate", "截止日期", "数据日期", "日期"):
            item = value.get(key)
            if isinstance(item, str) and re.search(r"\d{4}[-/]?\d{2}", item):
                return item
        for item in value.values():
            found = _find_report_date(item, depth + 1)
            if found:
                return found
    elif isinstance(value, list):
        for item in value[:20]:
            found = _find_report_date(item, depth + 1)
            if found:
                return found
    return ""


def _sql_path(path: Path) -> str:
    return str(path.resolve()).replace("'", "''")


def write_f10_snapshot(
    root: Path,
    code: str,
    table: str,
    payload: object,
    fetched_at: str | None = None,
    snapshot_date: str | None = None,
) -> dict:
    normalized_code = normalize_code(code)
    normalized_table = normalize_table(table)
    stamp = fetched_at or datetime.now().astimezone().isoformat(timespec="seconds")
    day = snapshot_date or datetime.now().astimezone().strftime("%Y-%m-%d")
    target_dir = Path(root) / f"snapshot_date={day}" / normalized_table
    data_path = target_dir / f"{normalized_code}.parquet"
    manifest_path = target_dir / f"{normalized_code}.manifest.json"
    if data_path.is_file() and manifest_path.is_file():
        try:
            existing = read_f10_snapshot(root, normalized_code, normalized_table, day)
            report_date = _find_report_date(payload)
            if existing.get("reportDate") or not report_date:
                return {
                    "code": normalized_code,
                    "table": normalized_table,
                    "snapshotDate": day,
                    "rows": existing["rows"],
                    "sha256": existing["sha256"],
                    "dir": existing["dir"],
                    "skipped": True,
                }
            # 旧快照缺少 reportDate 时允许补一次元数据；payload 仍以最新一次为准。
        except F10SnapshotError:
            # 只有损坏副本才允许重写；正常第一版永久保留。
            pass
    target_dir.mkdir(parents=True, exist_ok=True)
    text = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    report_date = _find_report_date(payload)
    temporary = target_dir / f".{normalized_code}.parquet.part"
    duckdb = _duckdb()
    connection = duckdb.connect(":memory:")
    try:
        connection.execute(
            "CREATE TABLE snapshot (code VARCHAR, tableName VARCHAR, snapshotDate VARCHAR, "
            "fetchedAt VARCHAR, reportDate VARCHAR, payload VARCHAR)"
        )
        connection.execute(
            "INSERT INTO snapshot VALUES (?, ?, ?, ?, ?, ?)",
            [normalized_code, normalized_table, day, stamp, report_date, text],
        )
        connection.execute(
            f"COPY snapshot TO '{_sql_path(temporary)}' (FORMAT PARQUET, COMPRESSION ZSTD)"
        )
    except Exception as error:  # noqa: BLE001
        raise F10SnapshotError(f"F10 快照写入失败：{error}") from error
    finally:
        connection.close()
    temporary.replace(data_path)
    digest = file_sha256(data_path)
    manifest = {
        "schema": "pythontdx.f10.pit.v1",
        "schemaVersion": SCHEMA_VERSION,
        "source": SOURCE,
        "code": normalized_code,
        "table": normalized_table,
        "snapshotDate": day,
        "fetchedAt": stamp,
        "reportDate": report_date,
        "rows": 1,
        "sha256": digest,
        "bytes": data_path.stat().st_size,
        "file": data_path.name,
    }
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return {
        "code": normalized_code,
        "table": normalized_table,
        "snapshotDate": day,
        "rows": 1,
        "sha256": digest,
        "dir": str(target_dir.resolve()),
        "skipped": False,
    }


def read_f10_snapshot(root: Path, code: str, table: str, snapshot_date: str) -> dict:
    normalized_code = normalize_code(code)
    normalized_table = normalize_table(table)
    day = str(snapshot_date).strip().replace("/", "-")
    target_dir = Path(root) / f"snapshot_date={day}" / normalized_table
    data_path = target_dir / f"{normalized_code}.parquet"
    manifest_path = target_dir / f"{normalized_code}.manifest.json"
    if not data_path.is_file() or not manifest_path.is_file():
        raise FileNotFoundError(f"{normalized_code} {normalized_table} {day} 没有 F10 快照")
    try:
        manifest = json.loads(manifest_path.read_text("utf-8"))
    except (OSError, ValueError) as error:
        raise F10SnapshotError(f"F10 快照 manifest 损坏：{error}") from error
    if file_sha256(data_path) != manifest.get("sha256"):
        raise F10SnapshotError("F10 快照 SHA256 校验失败")
    duckdb = _duckdb()
    connection = duckdb.connect(":memory:")
    try:
        row = connection.execute(
            f"SELECT code, tableName, snapshotDate, fetchedAt, reportDate, payload "
            f"FROM read_parquet('{_sql_path(data_path)}')"
        ).fetchone()
    except Exception as error:  # noqa: BLE001
        raise F10SnapshotError(f"F10 快照读取失败：{error}") from error
    finally:
        connection.close()
    if not row:
        raise F10SnapshotError("F10 快照为空")
    return {
        "code": row[0],
        "table": row[1],
        "snapshotDate": row[2],
        "fetchedAt": row[3],
        "reportDate": row[4],
        "payload": json.loads(row[5]),
        "rows": 1,
        "sha256": manifest.get("sha256"),
        "dir": str(target_dir.resolve()),
        "manifest": manifest,
    }


def list_f10_snapshots(root: Path, limit: int = 50) -> list[dict]:
    directory = Path(root)
    if not directory.is_dir():
        return []
    items: list[dict] = []
    for manifest_path in directory.glob("snapshot_date=*/*/*.manifest.json"):
        try:
            manifest = json.loads(manifest_path.read_text("utf-8"))
        except (OSError, ValueError):
            continue
        data_path = manifest_path.parent / str(manifest.get("file") or "")
        if not data_path.is_file():
            continue
        items.append(
            {
                "code": manifest.get("code"),
                "table": manifest.get("table"),
                "snapshotDate": manifest.get("snapshotDate"),
                "reportDate": manifest.get("reportDate"),
                "fetchedAt": manifest.get("fetchedAt"),
                "rows": int(manifest.get("rows") or 0),
                "bytes": data_path.stat().st_size,
                "sha256": manifest.get("sha256"),
                "dir": str(manifest_path.parent.resolve()),
            }
        )
    items.sort(key=lambda item: (str(item["snapshotDate"]), str(item["code"])), reverse=True)
    return items[: max(1, min(500, int(limit)))]
