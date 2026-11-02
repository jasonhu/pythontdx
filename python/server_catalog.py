"""7709 服务器文件目录与差分（可行范围内的清单）。

通达信 7709 的 `0x06b9` 只接受**具体文件名**，没有目录枚举命令；
因此“完整服务器目录”无法从公开协议取得。这里能做的是把官方 `zhb.zip`
（47 个文件）的清单、大小、CRC、逐文件 SHA256 落盘，并与上一版做差分。
这不是完整服务器索引，文档必须保留该边界。
"""
from __future__ import annotations

import hashlib
import json
import os
import zipfile
from datetime import datetime
from pathlib import Path


class ServerCatalogError(ValueError):
    pass


def _file_sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _catalog_paths(root: Path, day: str) -> tuple[Path, Path]:
    directory = Path(root) / f"snapshot_date={day}"
    return directory / "catalog.json", directory / "manifest.json"


def _previous_catalog(root: Path) -> dict | None:
    candidates = sorted(Path(root).glob("snapshot_date=*/catalog.json"), reverse=True)
    for path in candidates:
        try:
            return json.loads(path.read_text("utf-8"))
        except (OSError, ValueError):
            continue
    return None


def write_server_catalog(
    root: Path, zip_bytes: bytes, source_sha256: str, source_path: str = ""
) -> dict:
    try:
        archive = zipfile.ZipFile(__import__("io").BytesIO(zip_bytes))
    except (zipfile.BadZipFile, OSError) as error:
        raise ServerCatalogError(f"zhb.zip 解析失败：{error}") from error
    entries = []
    for info in archive.infolist():
        if info.is_dir():
            continue
        data = archive.read(info.filename)
        entries.append(
            {
                "name": info.filename,
                "bytes": len(data),
                "crc32": f"{info.CRC:08x}",
                "sha256": _file_sha(data),
            }
        )
    entries.sort(key=lambda item: item["name"])
    day = datetime.now().astimezone().strftime("%Y-%m-%d")
    directory = Path(root) / f"snapshot_date={day}"
    directory.mkdir(parents=True, exist_ok=True)
    catalog_path, manifest_path = _catalog_paths(root, day)
    previous = _previous_catalog(root)
    previous_entries = {
        item["name"]: item for item in (previous or {}).get("entries", []) if "name" in item
    }
    current_entries = {item["name"]: item for item in entries}
    diff = {
        "added": sorted(set(current_entries) - set(previous_entries)),
        "removed": sorted(set(previous_entries) - set(current_entries)),
        "changed": sorted(
            name
            for name in set(current_entries) & set(previous_entries)
            if current_entries[name]["sha256"] != previous_entries[name]["sha256"]
        ),
    }
    catalog = {
        "schema": "pythontdx.server_files.v1",
        "source": "TDX 7709 0x06b9 zhb.zip",
        "sourceSha256": source_sha256,
        "sourcePath": source_path,
        "generatedAt": datetime.now().astimezone().isoformat(timespec="seconds"),
        "snapshotDate": day,
        "count": len(entries),
        "entries": entries,
        "diff": diff,
    }
    temporary = directory / ".catalog.json.part"
    temporary.write_text(
        json.dumps(catalog, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8"
    )
    os.replace(temporary, catalog_path)
    manifest = {
        **{key: catalog[key] for key in ("schema", "source", "sourceSha256", "generatedAt", "snapshotDate", "count")},
        "file": catalog_path.name,
        "sha256": _file_sha(catalog_path.read_bytes()),
    }
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return {
        "snapshotDate": day,
        "count": len(entries),
        "diff": diff,
        "catalog": str(catalog_path.resolve()),
        "manifest": str(manifest_path.resolve()),
        "entries": entries,
    }


def list_server_catalogs(root: Path, limit: int = 20) -> list[dict]:
    directory = Path(root)
    if not directory.is_dir():
        return []
    items = []
    for path in sorted(directory.glob("snapshot_date=*/manifest.json"), reverse=True):
        try:
            manifest = json.loads(path.read_text("utf-8"))
        except (OSError, ValueError):
            continue
        items.append(
            {
                **manifest,
                "catalog": str((path.parent / str(manifest.get("file") or "")).resolve()),
                "dir": str(path.parent.resolve()),
            }
        )
    return items[: max(1, min(100, int(limit)))]
