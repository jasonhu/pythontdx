"""数据目录解析与旧名迁移。

1.1 起项目正式名改为 pythontdx，默认数据目录从
`~/.local/share/stocklens/data` 迁到 `~/.local/share/pythontdx/data`。
迁移只做一次、保留旧目录；失败时仍返回新路径，不影响启动。
"""
from __future__ import annotations

import os
import shutil
from pathlib import Path

LEGACY_HOME_NAME = "stocklens"
NEW_HOME_NAME = "pythontdx"


def _base_dir() -> Path:
    xdg = os.environ.get("XDG_DATA_HOME")
    return Path(xdg) if xdg else Path.home() / ".local" / "share"


def migrate_home(base: Path) -> Path:
    """把 base/stocklens 迁到 base/pythontdx；返回新 home（不一定存在）。"""
    new_home = Path(base) / NEW_HOME_NAME
    legacy_home = Path(base) / LEGACY_HOME_NAME
    if not (legacy_home / "data").exists() or (new_home / "data").exists():
        return new_home
    try:
        new_home.parent.mkdir(parents=True, exist_ok=True)
        legacy_home.rename(new_home)
    except OSError:
        # 目标已存在/跨卷：退化为复制，旧目录保留。
        try:
            shutil.copytree(legacy_home, new_home, dirs_exist_ok=True)
        except OSError:
            pass
    return new_home


def data_dir() -> Path:
    configured = os.environ.get("PYTHONTDX_DATA_DIR") or os.environ.get("STOCKLENS_DATA_DIR")
    if configured:
        return Path(configured).expanduser()
    return migrate_home(_base_dir()) / "data"
