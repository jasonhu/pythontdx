"""可重复的数据覆盖自检。

只读调用本地 tdx_bridge（不写数据、不下单），检查每类数据是否有真实返回。
用法：
    python3 scripts/data_audit.py
    python3 scripts/data_audit.py --json
失败返回非 0，便于放进发布前检查。
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BRIDGE = ROOT / "python" / "tdx_bridge.py"


def previous_weekday() -> str:
    value = date.today() - timedelta(days=1)
    while value.weekday() >= 5:
        value -= timedelta(days=1)
    return value.isoformat()


def call(cmd: str, payload: dict, timeout: int = 30) -> object:
    request = json.dumps({"id": 1, "cmd": cmd, "payload": payload}, ensure_ascii=False) + "\n"
    result = subprocess.run(
        [sys.executable, str(BRIDGE)],
        input=request,
        text=True,
        capture_output=True,
        timeout=timeout,
        cwd=ROOT,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or f"bridge exit {result.returncode}")
    line = result.stdout.strip().splitlines()
    if not line:
        raise RuntimeError("bridge 无输出")
    parsed = json.loads(line[-1])
    if not parsed.get("ok"):
        raise RuntimeError(str(parsed.get("error") or parsed))
    return parsed.get("result")


def positive(name: str, value: object, minimum: int = 1) -> dict:
    if isinstance(value, list):
        count = len(value)
    elif isinstance(value, dict):
        count = len(value.get("bars", value.get("points", value.get("days", value))))
    else:
        count = 0
    return {"name": name, "ok": count >= minimum, "count": count}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    checks: list[dict] = []
    failures: list[str] = []
    audit_date = previous_weekday()

    def add(name: str, value: object, minimum: int = 1) -> None:
        item = positive(name, value, minimum)
        checks.append(item)
        if not item["ok"]:
            failures.append(name)

    try:
        add("代码表", call("code_list", {"market": "all"}), 1000)
        add("A 股分类", call("category", {"kind": "A"}), 1)
        add("日 K", call("kline", {"code": "sh688499", "period": "day", "count": 20, "adjust": "none"}), 20)
        add("1 分钟 K", call("kline", {"code": "sh688499", "period": "1m", "count": 20, "adjust": "none"}), 20)
        add("周 K", call("kline", {"code": "sh600519", "period": "week", "count": 20, "adjust": "qfq"}), 20)
        add("月 K", call("kline", {"code": "sh600519", "period": "month", "count": 20, "adjust": "qfq"}), 20)
        add("5 分钟 K", call("kline", {"code": "sh600519", "period": "5m", "count": 20, "adjust": "qfq"}), 20)
        add("5 秒 K", call("kline", {"code": "sh600519", "period": "5s", "count": 20, "adjust": "qfq"}), 20)
        add("指数 K", call("kline", {"code": "sh000001", "period": "day", "count": 20, "adjust": "none"}), 20)
        add("分时", call("minute", {"code": "sh688499"}))
        add("五日分时", call("five_day", {"code": "sh688499"}))
        add("当日逐笔", call("trades", {"code": "sh688499", "count": 10}), 1)
        add("历史逐笔", call("trades", {"code": "sh688499", "count": 10, "date": audit_date}), 1)
        add("当日竞价", call("auctions", {"code": "sh688499"}), 1)
        add("历史竞价", call("auctions", {"code": "sh688499", "date": audit_date}), 1)
        add("F10 目录", call("f10_catalog", {"code": "sh688499"}), 10)
        add("公告", call("f10_announcements", {"code": "sh688499"}), 1)
        add("F10 估值", call("f10_valuation", {"code": "sh688499"}), 1)
        add("F10 财务", call("f10_finance", {"code": "sh688499"}), 1)
        add("F10 新闻", call("f10_news", {"code": "sh688499"}), 1)
        add("板块列表", call("mac_boards", {"boardType": 255}), 10)
        add("板块概念", call("blocks", {"kind": "gn"}), 1)
        add("行业", call("industries", {}), 1)
        add("沪深异动", call("mac_unusual", {"count": 10}), 1)
        add("资金流", call("mac_money_flow", {"code": "sh688499"}), 1)
        add("龙虎榜", call("f10_lhb_market", {}), 1)
        add("数据清单", call("data_inventory", {}))
    except Exception as error:  # noqa: BLE001 - 自检要报告而不是闪退
        failures.append(f"调用失败：{error}")

    report = {
        "ok": not failures,
        "checks": checks,
        "failures": failures,
        "note": "只读自检；只覆盖公开通达信 A 股通道，不包含 Level-2/付费/交易。",
    }
    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        for item in checks:
            print(f"{'PASS' if item['ok'] else 'FAIL'} {item['name']}: {item['count']}")
        if failures:
            print("FAILURES:", ", ".join(failures), file=sys.stderr)
        else:
            print("all data probes passed")
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
