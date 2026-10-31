"""把 tdx_bridge.py 打成单文件可执行程序。

默认且只使用 Nuitka（编译为机器码，onefile 不携带 Python 源码）：
    python3 -m pip install nuitka patchelf
    python3 python/build.py

产物：
    python/dist/tdx-bridge        （Windows 是 tdx-bridge.exe）

electron-builder 会把 python/dist 整个目录复制到
resources/tdx-bridge/，主进程按这个路径拉起子进程。
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def patchelf_path() -> str | None:
    found = shutil.which("patchelf")
    if found:
        return found
    local = Path.home() / ".local" / "bin" / "patchelf"
    return str(local) if local.exists() else None


def build_nuitka() -> None:
    try:
        import nuitka  # noqa: F401
    except ImportError:
        print(
            "缺少 Nuitka：先运行 python3 -m pip install nuitka；"
            "Linux onefile 还需要 patchelf。",
            file=sys.stderr,
        )
        raise SystemExit(1)

    patchelf = patchelf_path()
    if sys.platform.startswith("linux") and not patchelf:
        print(
            "Nuitka standalone/onefile 需要 patchelf：\n"
            "  python3 -m pip install --user patchelf\n"
            "或通过系统包管理器安装，再重试。",
            file=sys.stderr,
        )
        raise SystemExit(1)

    env = os.environ.copy()
    if patchelf:
        env["PATH"] = f"{Path(patchelf).parent}{os.pathsep}{env.get('PATH', '')}"

    command = [
        sys.executable,
        "-m",
        "nuitka",
        "--onefile",
        "--remove-output",
        f"--output-dir={ROOT / 'dist'}",
        "--output-filename=tdx-bridge",
        "--assume-yes-for-downloads",
        str(ROOT / "tdx_bridge.py"),
    ]
    print("[build] Nuitka:", " ".join(command), flush=True)
    subprocess.run(command, cwd=ROOT, env=env, check=True)


def main() -> None:
    build_nuitka()


if __name__ == "__main__":
    main()
