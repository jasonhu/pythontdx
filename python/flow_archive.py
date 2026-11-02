"""资金流每日 Parquet 归档。

MAC 0x1218 返回的是「当前/近 5 日」资金流，服务器不提供无限历史。
每次单票查询成功后，把收到的 payload 按交易日保存一份；同一天已存在则跳过。
"""
from __future__ import annotations

import json
import os
import re
from datetime import datetime
from pathlib import Path

from parquet_store import file_sha256

CODE_RE = re.compile(r"^(sh|sz|bj)\d{6}$")


class FlowArchiveError(ValueError):
    pass


def normalize_code(code: str) -> str:
    text = str(code).strip().lower()
    if not CODE_RE.fullmatch(text):
        raise FlowArchiveError("资金流归档只支持 sh/sz/bj + 6 位数字代码")
    return text


def _duckdb():
    try:
        import duckdb
    except ImportError as error:  # pragma: no cover
        raise FlowArchiveError("未安装 duckdb；请执行 python3 -m pip install -r requirements.txt") from error
    return duckdb


def _sql_path(path: Path) -> str:
    return str(path.resolve()).replace("'", "''")


def _trade_date(payload: dict) -> str:
    received = payload.get("receivedAt")
    if isinstance(received, (int, float)) and received > 0:
        return datetime.fromtimestamp(received / 1000).astimezone().strftime("%Y-%m-%d")
    return datetime.now().astimezone().strftime("%Y-%m-%d")


def write_flow_archive(
    root: Path, code: str, payload: dict, fetched_at: str | None = None
) -> dict:
    normalized = normalize_code(code)
    if not isinstance(payload, dict) or not payload:
        raise FlowArchiveError("资金流数据为空，不能归档")
    day = _trade_date(payload)
    stamp = fetched_at or datetime.now().astimezone().isoformat(timespec="seconds")
    directory = Path(root) / f"trade_date={day}"
    data_path = directory / f"{normalized}.parquet"
    manifest_path = directory / f"{normalized}.manifest.json"
    if data_path.is_file() and manifest_path.is_file():
        try:
            read_flow_archive(root, normalized, day)
            return {"code": normalized, "tradeDate": day, "skipped": True}
        except FlowArchiveError:
            pass
    directory.mkdir(parents=True, exist_ok=True)
    temporary = directory / f".{normalized}.parquet.part"
    text = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    duckdb = _duckdb()
    connection = duckdb.connect(":memory:")
    try:
        connection.execute(
            "CREATE TABLE flow (code VARCHAR, tradeDate VARCHAR, fetchedAt VARCHAR, payload VARCHAR)"
        )
        connection.execute(
            "INSERT INTO flow VALUES (?, ?, ?, ?)", [normalized, day, stamp, text]
        )
        connection.execute(
            f"COPY flow TO '{_sql_path(temporary)}' (FORMAT PARQUET, COMPRESSION ZSTD)"
        )
    except Exception as error:  # noqa: BLE001
        raise FlowArchiveError(f"资金流归档写入失败：{error}") from error
    finally:
        connection.close()
    temporary.replace(data_path)
    digest = file_sha256(data_path)
    manifest_path.write_text(
        json.dumps(
            {
                "schema": "pythontdx.money_flow.v1",
                "code": normalized,
                "tradeDate": day,
                "fetchedAt": stamp,
                "sha256": digest,
                "bytes": data_path.stat().st_size,
                "file": data_path.name,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    return {"code": normalized, "tradeDate": day, "skipped": False, "sha256": digest}


def read_flow_archive(root: Path, code: str, trade_date: str) -> dict:
    normalized = normalize_code(code)
    day = str(trade_date).strip().replace("/", "-")
    directory = Path(root) / f"trade_date={day}"
    data_path = directory / f"{normalized}.parquet"
    manifest_path = directory / f"{normalized}.manifest.json"
    if not data_path.is_file() or not manifest_path.is_file():
        raise FileNotFoundError(f"{normalized} {day} 没有资金流归档")
    manifest = json.loads(manifest_path.read_text("utf-8"))
    if file_sha256(data_path) != manifest.get("sha256"):
        raise FlowArchiveError("资金流归档 SHA256 校验失败")
    duckdb = _duckdb()
    connection = duckdb.connect(":memory:")
    try:
        row = connection.execute(
            f"SELECT code, tradeDate, fetchedAt, payload FROM read_parquet('{_sql_path(data_path)}')"
        ).fetchone()
    finally:
        connection.close()
    if not row:
        raise FlowArchiveError("资金流归档为空")
    return {
        "code": row[0],
        "tradeDate": row[1],
        "fetchedAt": row[2],
        "payload": json.loads(row[3]),
        "sha256": manifest.get("sha256"),
        "dir": str(directory.resolve()),
    }


def list_flow_archives(root: Path, limit: int = 50) -> list[dict]:
    directory = Path(root)
    if not directory.is_dir():
        return []
    items = []
    for manifest_path in directory.glob("trade_date=*/*.manifest.json"):
        try:
            manifest = json.loads(manifest_path.read_text("utf-8"))
        except (OSError, ValueError):
            continue
        data_path = manifest_path.parent / str(manifest.get("file") or "")
        if not data_path.is_file():
            continue
        items.append({**manifest, "bytes": data_path.stat().st_size, "dir": str(manifest_path.parent.resolve())})
    items.sort(key=lambda item: (str(item["tradeDate"]), str(item["code"])), reverse=True)
    return items[: max(1, min(500, int(limit)))]
