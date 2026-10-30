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
VALUATION_ENTRY = "HQServ.hq_nlp_gpsj"
FINANCE_ENTRY = "CWServ.tdxf10_gg_cwfx"
BUSINESS_ENTRY = "CWServ.tdxf10_gg_jyfx"
BUSINESS_PERIOD_ENTRY = "CWServ.tdxf10_gg_comreq"
SHAREHOLDER_ENTRY = "CWServ.tdxf10_gg_gdyj"
REPORT_ENTRY = "CWServ.tdxf10_gg_gszx"
STATEMENT_ENTRY = "CWServ.tdxf10_gg_cwfx"

FINANCE_LABELS = {
    "T002": "报告期",
    "mgsy": "每股收益",
    "kfjlr": "扣非净利润",
    "mgxjll": "每股经营现金流",
    "lrze": "利润总额",
    "jyr": "净利润",
    "jzzsyl": "净资产收益率",
    "xsmll": "毛利率",
    "jlrtbzzl": "净利润同比",
    "yysrtb": "营收同比",
    "yyzsrhb": "营收环比",
    "jlrhb": "净利润环比",
    "pjjzcsyl": "平均净资产收益率",
    "kfjlrhb": "扣非净利润环比",
}

STATEMENT_METRICS = {
    "zcfzb": {
        0: [("rq", "报告期"), ("T039", "资产总计"), ("T062", "负债合计"), ("T071", "所有者权益合计"), ("T007", "货币资金"), ("T016", "存货"), ("T010", "应收账款"), ("T040", "短期借款")],
        1: [("rq", "报告期"), ("T048", "资产总计"), ("T083", "负债合计"), ("T093", "所有者权益合计"), ("T010", "现金及存放央行"), ("T028", "发放贷款及垫款"), ("T057", "吸收存款")],
    },
    "lyb": {
        0: [("rq", "报告期"), ("T035", "营业总收入"), ("T064", "营业总成本"), ("T020", "营业利润"), ("T026", "利润总额"), ("T029", "净利润"), ("T030", "归母净利润")],
        1: [("rq", "报告期"), ("T008", "营业收入"), ("T028", "营业支出"), ("T042", "营业利润"), ("T047", "利润总额"), ("T050", "净利润"), ("T051", "归母净利润")],
    },
    "xjllb": {
        0: [("rq", "报告期"), ("T017", "经营活动净额"), ("T029", "投资活动净额"), ("T038", "筹资活动净额"), ("T041", "现金净增加")],
        1: [("rq", "报告期"), ("T033", "经营活动净额"), ("T044", "投资活动净额"), ("T055", "筹资活动净额"), ("T058", "现金净增加")],
    },
}

REPORT_LABELS = {
    "T004": "评级",
    "T009": "分析师",
    "T012": "日期",
    "T039": "标题",
    "T011": "记录ID",
}

SHAREHOLDER_LABELS = {
    "gd": "股东名称",
    "rq": "报告期",
    "cgs": "持股数",
    "bl": "持股比例%",
    "lb": "股东类型",
    "xz": "股本性质",
}

BUSINESS_LABELS = {
    "N000": "分类",
    "N002": "项目",
    "N003": "营业收入",
    "N004": "收入占比%",
    "N005": "营业利润",
    "N006": "利润占比%",
    "N007": "营业成本",
    "N008": "成本占比%",
    "N009": "毛利率%",
}

VALUATION_LABELS = {
    "DATE": "日期",
    "PETTM": "PE(TTM)",
    "PEBFW": "PE 分位",
    "PBMRQ": "PB(MRQ)",
    "PBBFW": "PB 分位",
    "PCFOCFTTM": "PCF(经营现金流 TTM)",
    "PCFBFW": "PCF 分位",
    "PSTTM": "PS(TTM)",
    "PSBFW": "PS 分位",
    "PEG": "PEG",
    "AVGMVM": "平均市值",
    "ALIQMV": "流通市值",
}

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


def parse_valuation_payload(payload: dict) -> dict:
    if int(payload.get("ErrorCode") or 0) != 0:
        raise F10Error(f"7615 返回错误码 {payload.get('ErrorCode')}")
    result_sets = payload.get("ResultSets") or []
    if len(result_sets) < 2:
        return {"columns": [], "rows": []}
    table = result_sets[1]
    raw_columns = table.get("ColName") or [
        str(des.get("Name") or "") for des in (table.get("ColDes") or [])
    ]
    columns = [VALUATION_LABELS.get(str(name), str(name)) for name in raw_columns]
    rows = [list(values) for values in table.get("Content") or []]
    return {"columns": columns, "rows": rows}


def parse_finance_payload(payload: dict) -> dict:
    if int(payload.get("ErrorCode") or 0) != 0:
        raise F10Error(f"7615 返回错误码 {payload.get('ErrorCode')}")
    result_sets = payload.get("ResultSets") or []
    if not result_sets:
        return {"columns": [], "rows": []}
    table = result_sets[0]
    raw_columns = table.get("ColName") or []
    columns = [FINANCE_LABELS.get(str(name), str(name)) for name in raw_columns]
    rows = [list(values) for values in table.get("Content") or []][:20]
    return {"columns": columns, "rows": rows}


def parse_business_payload(payload: dict) -> dict:
    if int(payload.get("ErrorCode") or 0) != 0:
        raise F10Error(f"7615 返回错误码 {payload.get('ErrorCode')}")
    result_sets = payload.get("ResultSets") or []
    if not result_sets:
        return {"columns": [], "rows": []}
    table = result_sets[0]
    raw_columns = [str(name) for name in (table.get("ColName") or [])]
    indexes = [index for index, name in enumerate(raw_columns) if name in BUSINESS_LABELS]
    columns = [BUSINESS_LABELS[raw_columns[index]] for index in indexes]
    rows = [
        [values[index] for index in indexes]
        for values in (table.get("Content") or [])
    ]
    return {"columns": columns, "rows": rows}


def _post_tqlex(entry: str, body: dict) -> dict:
    request = Request(
        f"{TQLEX_URL}?Entry={entry}",
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
        raise F10Error(f"7615 请求失败：{error}") from error
    try:
        parsed = json.loads(raw.decode("utf-8-sig"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise F10Error("7615 返回非 JSON") from error
    if not isinstance(parsed, dict):
        raise F10Error("7615 返回结构异常")
    return parsed


def parse_shareholder_payload(payload: dict) -> dict:
    if int(payload.get("ErrorCode") or 0) != 0:
        raise F10Error(f"7615 返回错误码 {payload.get('ErrorCode')}")
    result_sets = payload.get("ResultSets") or []
    if not result_sets:
        return {"columns": [], "rows": []}
    table = result_sets[0]
    raw_columns = [str(name) for name in (table.get("ColName") or [])]
    indexes = [index for index, name in enumerate(raw_columns) if name in SHAREHOLDER_LABELS]
    columns = [SHAREHOLDER_LABELS[raw_columns[index]] for index in indexes]
    rows = [
        [values[index] for index in indexes]
        for values in (table.get("Content") or [])
    ][:20]
    return {"columns": columns, "rows": rows}


def parse_report_payload(payload: dict) -> dict:
    if int(payload.get("ErrorCode") or 0) != 0:
        raise F10Error(f"7615 返回错误码 {payload.get('ErrorCode')}")
    result_sets = payload.get("ResultSets") or []
    if not result_sets:
        return {"columns": [], "rows": []}
    table = result_sets[0]
    raw_columns = [str(name) for name in (table.get("ColName") or [])]
    indexes = [index for index, name in enumerate(raw_columns) if name in REPORT_LABELS]
    columns = [REPORT_LABELS[raw_columns[index]] for index in indexes]
    rows = [
        [values[index] for index in indexes]
        for values in (table.get("Content") or [])
    ][:20]
    return {"columns": columns, "rows": rows}


def parse_statement_payload(payload: dict, kind: str, full: bool = False) -> dict:
    if int(payload.get("ErrorCode") or 0) != 0:
        raise F10Error(f"7615 返回错误码 {payload.get('ErrorCode')}")
    result_sets = payload.get("ResultSets") or []
    if not result_sets:
        return {"columns": [], "rows": []}
    table = result_sets[0]
    raw_columns = [str(name) for name in (table.get("ColName") or [])]
    template = 0
    if len(result_sets) > 1:
        meta = result_sets[1]
        meta_columns = [str(name) for name in (meta.get("ColName") or [])]
        if "nhytype" in meta_columns and meta.get("Content"):
            try:
                template = int(meta["Content"][0][meta_columns.index("nhytype")] or 0)
            except (ValueError, IndexError, TypeError):
                template = 0
    metrics = STATEMENT_METRICS.get(kind, {}).get(template)
    if metrics and not full:
        indexes = [(raw_columns.index(key), label) for key, label in metrics if key in raw_columns]
        columns = [label for _, label in indexes]
        rows = [
            [values[index] for index, _ in indexes]
            for values in (table.get("Content") or [])[:4]
        ]
    else:
        columns = raw_columns
        rows = [list(values) for values in (table.get("Content") or [])[:4]]
    return {
        "columns": columns,
        "rows": rows,
        "template": template,
        "kind": kind,
        "full": full,
    }


def fetch_statement(code: str, kind: str = "zcfzb", full: bool = False) -> dict:
    _market, symbol = _market_of(code)
    if kind not in {"zcfzb", "lyb", "xjllb"}:
        raise F10Error(f"未知报表类型：{kind}")
    payload = _post_tqlex(STATEMENT_ENTRY, {"Params": [symbol, kind, ""]})
    return parse_statement_payload(payload, kind, full)


def fetch_reports(code: str) -> dict:
    _market, symbol = _market_of(code)
    payload = _post_tqlex(
        REPORT_ENTRY,
        {"Params": [symbol, "gsyj", "", "0", "1", "20"]},
    )
    return parse_report_payload(payload)


def fetch_shareholders(code: str) -> dict:
    _market, symbol = _market_of(code)
    payload = _post_tqlex(
        SHAREHOLDER_ENTRY,
        {"Params": [symbol, "sdgdbgq", "", "", "1", "1", "20"]},
    )
    return parse_shareholder_payload(payload)


def fetch_business(code: str) -> dict:
    _market, symbol = _market_of(code)
    periods = _post_tqlex(BUSINESS_PERIOD_ENTRY, {"Params": ["zygcfx", symbol]})
    tables = periods.get("ResultSets") or []
    if not tables or not tables[0].get("Content"):
        return {"columns": [], "rows": []}
    report_date = str(tables[0]["Content"][0][0])
    payload = _post_tqlex(
        BUSINESS_ENTRY,
        {"Params": [symbol, "zygc", report_date]},
    )
    result = parse_business_payload(payload)
    result["reportDate"] = report_date
    return result


def fetch_finance(code: str) -> dict:
    _market, symbol = _market_of(code)
    request = Request(
        f"{TQLEX_URL}?Entry={FINANCE_ENTRY}",
        data=json.dumps({"Params": [symbol, "zyzb", ""]}, separators=(",", ":")).encode("utf-8"),
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
        raise F10Error(f"7615 财务请求失败：{error}") from error
    try:
        parsed = json.loads(raw.decode("utf-8-sig"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise F10Error("7615 财务返回非 JSON") from error
    if not isinstance(parsed, dict):
        raise F10Error("7615 财务返回结构异常")
    return parse_finance_payload(parsed)


def fetch_valuation(code: str) -> dict:
    market, symbol = _market_of(code)
    payload = {
        "ReqId": "200191",
        "Code": f"{symbol}|{market}",
        "BeginDate": "0",
        "EndDate": "0",
        "Page": "0",
        "PageSize": "20",
        "modname": "mod_gpsj.dll",
    }
    request = Request(
        f"{TQLEX_URL}?Entry={VALUATION_ENTRY}",
        data=json.dumps([payload], separators=(",", ":")).encode("utf-8"),
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
        raise F10Error(f"7615 估值请求失败：{error}") from error
    try:
        parsed = json.loads(raw.decode("utf-8-sig"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise F10Error("7615 估值返回非 JSON") from error
    if not isinstance(parsed, dict):
        raise F10Error("7615 估值返回结构异常")
    return parse_valuation_payload(parsed)


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
