"""7615 TQLEX 在线 F10（公告）。

和 7709 的 0x02cf/0x02d0 文本 F10 是两条独立通路；这里只调用免费 HTTP 网关，
不碰付费研报/交易数据。
"""

from __future__ import annotations

import json
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

TQLEX_URL = "http://static.tdx.com.cn:7615/TQLEX"
ENTRY = "CWSearch.tzx_rcache"
PROFILE_ENTRY = "CWServ.tdxf10_gg_gsgk"

PROFILE_LABELS = {
    "T035": "股票类别",
    "T031": "上市日期",
    "T051": "发行方式",
    "fxzd": "发行制度",
    "mgmz": "每股面值",
    "T042": "发行价格",
    "T044": "总发行数量",
    "T056": "实际募资总额",
    "T057": "实际募资净额",
    "T059": "首日开盘价",
    "T060": "首日收盘价",
    "zcxs": "主承销商",
    "bjr": "上市保荐人",
    "T049": "上市板块",
    "ssbk": "上市板块",
}


class F10Error(Exception):
    pass


def _market_of(code: str) -> tuple[int, str]:
    text = code.strip().lower()
    if len(text) != 8 or text[:2] not in {"sh", "sz", "bj"}:
        raise F10Error(f"代码格式不合法：{code}")
    symbol = text[2:]
    if not symbol.isdigit():
        raise F10Error(f"代码格式不合法：{code}")
    market = 1 if text.startswith("sh") else 0 if text.startswith("sz") else 2
    return market, symbol


def parse_announcements_payload(payload: dict) -> list[dict]:
    if int(payload.get("ErrorCode") or 0) != 0:
        raise F10Error(f"7615 返回错误码 {payload.get('ErrorCode')}")
    result_sets = payload.get("ResultSets") or []
    if not result_sets:
        return []
    table = result_sets[0]
    columns = table.get("ColName") or []
    content = table.get("Content") or []
    rows: list[dict] = []
    for values in content:
        row = dict(zip(columns, values))
        rows.append(
            {
                "id": str(row.get("rec_id") or ""),
                "date": str(row.get("issue_date") or "")[:10],
                "title": str(row.get("title") or ""),
                "type": str(row.get("typename") or ""),
                "source": str(row.get("source") or ""),
                "url": str(row.get("url") or ""),
            }
        )
    return rows


def parse_profile_payload(payload: dict) -> dict:
    if int(payload.get("ErrorCode") or 0) != 0:
        raise F10Error(f"7615 返回错误码 {payload.get('ErrorCode')}")
    result_sets = payload.get("ResultSets") or []
    if not result_sets:
        return {"columns": [], "rows": []}
    table = result_sets[0]
    raw_columns = table.get("ColName") or []
    columns = [PROFILE_LABELS.get(str(name), str(name)) for name in raw_columns]
    rows = [list(values) for values in table.get("Content") or []]
    return {"columns": columns, "rows": rows}


def fetch_profile(code: str) -> dict:
    _market, symbol = _market_of(code)
    request = Request(
        f"{TQLEX_URL}?Entry={PROFILE_ENTRY}",
        data=json.dumps({"Params": ["8", symbol, ""]}, separators=(",", ":")).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "StockLens/1.0",
        },
        method="POST",
    )
    try:
        with urlopen(request, timeout=12) as response:
            raw = response.read()
    except (HTTPError, URLError, TimeoutError) as error:
        raise F10Error(f"7615 公司概况请求失败：{error}") from error
    try:
        payload = json.loads(raw.decode("utf-8-sig"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise F10Error("7615 公司概况返回非 JSON") from error
    if not isinstance(payload, dict):
        raise F10Error("7615 公司概况返回结构异常")
    return parse_profile_payload(payload)


def fetch_announcements(code: str) -> list[dict]:
    market, symbol = _market_of(code)
    body = {
        "action": "get",
        "key": f"gg:{market}_{symbol}",
        "bin": "1",
        "qsid": "tdx",
    }
    request = Request(
        f"{TQLEX_URL}?Entry={ENTRY}",
        data=json.dumps(body, separators=(",", ":")).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "StockLens/1.0",
        },
        method="POST",
    )
    try:
        with urlopen(request, timeout=12) as response:
            raw = response.read()
    except (HTTPError, URLError, TimeoutError) as error:
        raise F10Error(f"7615 公告请求失败：{error}") from error
    try:
        payload = json.loads(raw.decode("utf-8-sig"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise F10Error("7615 公告返回非 JSON") from error
    if not isinstance(payload, dict):
        raise F10Error("7615 公告返回结构异常")
    return parse_announcements_payload(payload)
