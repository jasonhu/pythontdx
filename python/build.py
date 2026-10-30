"""把 tdx_bridge.py 打成单文件可执行程序。

用法：
    pip install pyinstaller
    python python/build.py

产物：
    python/dist/tdx-bridge        （Windows 是 tdx-bridge.exe）

electron-builder 会把 python/dist 整个目录复制到
resources/tdx-bridge/，主进程按这个路径拉起子进程。
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def main() -> None:
    try:
        import PyInstaller.__main__
    except ImportError:
        print("缺少 PyInstaller：先运行 pip install pyinstaller", file=sys.stderr)
        raise SystemExit(1)

    PyInstaller.__main__.run(
        [
            str(ROOT / "tdx_bridge.py"),
            "--name",
            "tdx-bridge",
            "--onefile",
            "--clean",
            "--noconfirm",
            "--distpath",
            str(ROOT / "dist"),
            "--workpath",
            str(ROOT / "build"),
            "--specpath",
            str(ROOT / "build"),
        ]
    )


if __name__ == "__main__":
    main()
