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


DIVIDEND_LABELS = {
    "rq": "分红年度",
    "T003": "董事会日期",
    "T004": "分红方案",
    "T006": "每股收益",
    "T026": "加权净资产收益率%",
    "T021": "股权登记日",
    "T023": "除权派息日",
    "T036": "方案进度",
    "glzfl": "股利支付率%",
    "jdcode": "派发对象",
}


CAPITAL_SECTIONS = {
    "structure": ("gbjg", "股本结构"),
    "changes": ("gbbd", "股本变动"),
    "buyback": ("gphg", "股票回购"),
    "restricted": ("xslt", "限售流通"),
}

CAPITAL_LABELS = {
    "structure": {
        "T002": "截止日期",
        "T003": "总股本",
        "T004": "已流通股份",
        "T005": "未流通/待流通",
        "T010": "流通A股",
        "T011": "无限售条件流通股",
        "T019": "流通股份合计",
        "N010": "其它统计口径",
    },
    "changes": {
        "T002": "变动日期",
        "T003": "变动后总股本",
        "T004": "变动前总股本",
        "T006": "变动数量",
        "T007": "变动比例%",
        "T008": "变动原因码",
    },
    "buyback": {
        "N001": "公告日",
        "N002": "进度",
        "N004": "首次公告日",
        "N005": "已回购数量",
        "N006": "已回购占比%",
        "N007": "回购均价",
        "N008": "拟回购金额上限",
        "N009": "回购起始日",
        "N010": "回购截止日",
        "N021": "回购用途",
        "closep": "最新收盘价",
    },
    "restricted": {
        "T003": "解禁日",
        "T004": "解禁市值",
        "T006": "股份来源",
        "T010": "解禁数量",
        "T012": "状态",
        "T014": "解禁数量(万股)",
    },
}


def fetch_capital_structure(code: str, section: str = "structure") -> dict:
    if section not in CAPITAL_SECTIONS:
        raise F10Error(f"不支持的股本分区：{section}")
    raw, _label = CAPITAL_SECTIONS[section]
    _market, symbol = _market_of(code)
    payload = _post_tqlex(
        "CWServ.tdxf10_gg_gbjg",
        {"Params": [symbol, raw]},
    )
    if int(payload.get("ErrorCode") or 0) != 0:
        raise F10Error(f"7615 股本结构返回错误码 {payload.get('ErrorCode')}")
    tables = payload.get("ResultSets") or []
    if not tables:
        return {"section": section, "columns": [], "rows": [], "count": 0}
    table = tables[0]
    raw_columns = [str(name) for name in (table.get("ColName") or [])]
    return {
        "section": section,
        "columns": [CAPITAL_LABELS.get(section, {}).get(name, name) for name in raw_columns],
        "rows": table.get("Content") or [],
        "count": len(table.get("Content") or []),
    }


INSTITUTION_LABELS = {
    "T002": "报告期",
    "T003": "机构家数",
    "T004": "家数变动",
    "T005": "持股总数",
    "T006": "变动股数",
    "T007": "持股市值",
    "T008": "持股占比%",
    "T010": "市值占比%",
    "T014": "户均持股",
}


def fetch_institutions(code: str) -> dict:
    _market, symbol = _market_of(code)
    payload = _post_tqlex(
        "CWServ.tdxf10_gg_gdyj",
        {"Params": [symbol, "jgcg", "", "", "1", "1", "20"]},
    )
    if int(payload.get("ErrorCode") or 0) != 0:
        raise F10Error(f"7615 机构持仓返回错误码 {payload.get('ErrorCode')}")
    tables = payload.get("ResultSets") or []
    if not tables:
        return {"columns": [], "rows": [], "count": 0}
    table = tables[0]
    raw = [str(name) for name in (table.get("ColName") or [])]
    return {
        "columns": [INSTITUTION_LABELS.get(name, name) for name in raw],
        "rows": table.get("Content") or [],
        "count": len(table.get("Content") or []),
    }


SHAREHOLDER_CHANGE_LABELS = {
    "qs": "变动起始日",
    "jz": "变动截止日",
    "T003": "公告日",
    "T005": "股东名称",
    "T006": "成交均价",
    "T007": "变动数量",
    "T008": "变动后持股数",
    "T009": "变动方式",
    "T011": "身份",
}

SHAREHOLDER_CHANGE_COLUMNS = ("qs", "jz", "T005", "T006", "T007", "T008", "T009", "T011")


def fetch_shareholder_changes(code: str) -> dict:
    _market, symbol = _market_of(code)
    payload = _post_tqlex(
        "CWServ.tdxf10_gg_gdyj",
        {"Params": [symbol, "cgbd", "", "", "1", "1", "20"]},
    )
    if int(payload.get("ErrorCode") or 0) != 0:
        raise F10Error(f"7615 股东增减持返回错误码 {payload.get('ErrorCode')}")
    tables = payload.get("ResultSets") or []
    if not tables:
        return {"columns": [], "rows": [], "count": 0}
    table = tables[0]
    raw = [str(name) for name in (table.get("ColName") or [])]
    wanted = [name for name in SHAREHOLDER_CHANGE_COLUMNS if name in raw]
    indexes = [raw.index(name) for name in wanted]
    rows = table.get("Content") or []
    return {
        "columns": [SHAREHOLDER_CHANGE_LABELS.get(name, name) for name in wanted],
        "rows": [[row[index] for index in indexes] for row in rows],
        "count": len(rows),
    }


CIRCULATING_SHAREHOLDER_LABELS = {
    "rq": "报告期",
    "gd": "股东名称",
    "cgs": "持股数",
    "xz": "股份性质",
    "lb": "股东类别",
    "pos": "排名",
}


def fetch_circulating_shareholders(code: str) -> dict:
    _market, symbol = _market_of(code)
    payload = _post_tqlex(
        "CWServ.tdxf10_gg_gdyj",
        {"Params": [symbol, "ltgd", "", "", "1", "1", "20"]},
    )
    if int(payload.get("ErrorCode") or 0) != 0:
        raise F10Error(f"7615 十大流通股东返回错误码 {payload.get('ErrorCode')}")
    tables = payload.get("ResultSets") or []
    if len(tables) < 2:
        return {"columns": [], "rows": [], "count": 0}
    table = tables[1]
    raw = [str(name) for name in (table.get("ColName") or [])]
    wanted = [name for name in ("rq", "gd", "cgs", "lb", "pos", "xz") if name in raw]
    indexes = [raw.index(name) for name in wanted]
    rows = [row for row in (table.get("Content") or [])]
    return {
        "columns": [CIRCULATING_SHAREHOLDER_LABELS.get(name, name) for name in wanted],
        "rows": [[row[index] for index in indexes] for row in rows],
        "count": len(rows),
    }


SHAREHOLDER_COUNT_LABELS = {
    "T002": "报告期",
    "T003": "股东人数",
    "T004": "户均持股数",
    "T005": "股东人数环比%",
    "T006": "户均持股数环比%",
    "T007": "户均持股市值(万元)",
    "T012": "股东人数变动",
}


def fetch_shareholder_count(code: str) -> dict:
    _market, symbol = _market_of(code)
    payload = _post_tqlex(
        "CWServ.tdxf10_gg_gdyj",
        {"Params": [symbol, "gdrs", "", "", "1", "1", "30"]},
    )
    if int(payload.get("ErrorCode") or 0) != 0:
        raise F10Error(f"7615 股东人数返回错误码 {payload.get('ErrorCode')}")
    tables = payload.get("ResultSets") or []
    if not tables:
        return {"columns": [], "rows": [], "count": 0}
    table = tables[0]
    raw = [str(name) for name in (table.get("ColName") or [])]
    return {
        "columns": [SHAREHOLDER_COUNT_LABELS.get(name, name) for name in raw],
        "rows": table.get("Content") or [],
        "count": len(table.get("Content") or []),
    }


def fetch_dividend(code: str, section: str = "fh") -> dict:
    _market, symbol = _market_of(code)
    payload = _post_tqlex(
        "CWServ.tdxf10_gg_fhrz",
        {"Params": [symbol, section]},
    )
    if int(payload.get("ErrorCode") or 0) != 0:
        raise F10Error(f"7615 分红融资返回错误码 {payload.get('ErrorCode')}")
    tables = payload.get("ResultSets") or []
    if not tables:
        return {"columns": [], "rows": [], "count": 0}
    table = tables[0]
    raw = [str(name) for name in (table.get("ColName") or [])]
    return {
        "columns": [DIVIDEND_LABELS.get(name, name) for name in raw],
        "rows": table.get("Content") or [],
        "count": len(table.get("Content") or []),
    }


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


def parse_news_payload(payload: dict) -> list[dict]:
    if int(payload.get("ErrorCode") or 0) != 0:
        raise F10Error(f"7615 返回错误码 {payload.get('ErrorCode')}")
    result_sets = payload.get("ResultSets") or []
    if not result_sets:
        return []
    table = result_sets[0]
    columns = table.get("ColName") or []
    rows: list[dict] = []
    for values in table.get("Content") or []:
        row = dict(zip(columns, values))
        rows.append(
            {
                "id": str(row.get("rec_id") or ""),
                "date": str(row.get("issue_date") or "")[:16],
                "title": str(row.get("title") or ""),
                "source": str(row.get("source") or ""),
            }
        )
    return rows


TRADING_SECTIONS = {
    "margin": ("rzrq", ""),
    "block": ("dzjy", ""),
    "dragon": ("lgt", "2"),
    "north": ("islgt", ""),
    "reports": ("yxsbxx", ""),
    "kcb": ("checkkcb", ""),
    "limit_up": ("ztfx", ""),
    "limit_down": ("dtfx", ""),
    "bonds": ("zrq", ""),
    "main_force": ("zlpskcj", ""),
    "margin_history": ("rzrq_sj", ""),
}

TRADING_LABELS = {
    "margin": {"T001": "交易日", "T003": "融资余额", "T004": "融资买入额", "T005": "融券余额", "ClosePrice": "收盘价"},
    "block": {"yjl": "溢价率"},
    "dragon": {"rq": "日期", "T006": "买入额", "T007": "卖出额"},
    "north": {"T001": "持股"},
    "reports": {},
    "kcb": {"sc": "科创板标记"},
    "margin_history": {
        "id": "序号",
        "N001": "日期",
        "N002": "代码",
        "N003": "名称",
        "N004": "融资余额",
        "N008": "融券金额",
        "N009": "占流通市值%",
        "N013": "上市日期",
    },
    "limit_up": {
        "currq": "当日",
        "lx": "类型",
        "sT002": "日期",
        "T011": "时间",
        "fdje": "封单额",
        "zt": "主题",
        "yy": "原因",
        "N005": "成交额",
    },
    "limit_down": {
        "currq": "当日",
        "lx": "类型",
        "sT002": "日期",
        "T011": "时间",
        "fdje": "封单额",
        "zt": "主题",
        "yy": "原因",
        "N005": "成交额",
    },
}


def parse_trading_payload(payload: dict, section: str) -> dict:
    if int(payload.get("ErrorCode") or 0) != 0:
        raise F10Error(f"7615 返回错误码 {payload.get('ErrorCode')}")
    labels = TRADING_LABELS.get(section, {})
    tables = payload.get("ResultSets") or []
    if not tables:
        return {"section": section, "rawColumns": [], "columns": [], "rows": [], "count": 0}
    # 分区主表固定是 table0；空表就是“无记录”，不能拿调整因子/收盘价表凑数。
    table = tables[0]
    content = table.get("Content") or []
    if not content:
        return {"section": section, "rawColumns": [], "columns": [], "rows": [], "count": 0}
    raw_columns = [str(name) for name in (table.get("ColName") or [])]
    columns = [labels.get(name, name) for name in raw_columns]
    return {
        "section": section,
        "rawColumns": raw_columns,
        "columns": columns,
        "rows": content,
        "count": len(content),
    }


LHB_LABELS = {
    "N001": "日期",
    "N002": "代码",
    "sc": "市场",
    "N003": "名称",
    "N004": "收盘",
    "N005": "涨跌幅",
    "N006": "板块代码",
    "N007": "行业代码",
    "N008": "上榜原因",
    "N009": "营业部",
    "N010": "买入额",
    "N011": "卖出额",
    "N012": "方向",
    "N013": "排名",
}


def parse_lhb_market_payload(payload: dict) -> dict:
    if int(payload.get("ErrorCode") or 0) != 0:
        raise F10Error(f"7615 龙虎榜返回错误码 {payload.get('ErrorCode')}")
    tables = payload.get("ResultSets") or []
    if not tables:
        return {"section": "dragon_market", "rawColumns": [], "columns": [], "rows": [], "count": 0}
    table = tables[0]
    raw_columns = [str(name) for name in (table.get("ColName") or [])]
    return {
        "section": "dragon_market",
        "rawColumns": raw_columns,
        "columns": [LHB_LABELS.get(name, name) for name in raw_columns],
        "rows": table.get("Content") or [],
        "count": len(table.get("Content") or []),
    }


MARKET_SECTIONS = {
    "basic": ("CWServ.skef10_dpzx_jbxx", ["002", "000001"]),
    "margin": ("CWServ.skef10_dpzx_rzrq", ["001", "000001"]),
    "new": ("CWServ.skef10_dpzx_xgfx", ["002"]),
    "capital": ("CWServ.skef10_dpzx_scgl", ["004"]),
}

MARKET_LABELS = {
    "basic": {
        "N001": "指数名称",
        "N002": "简称",
        "N003": "类型",
        "N004": "发布日期",
        "N005": "代码",
        "N006": "成立日期",
        "N007": "样本数",
        "N009": "简介",
    },
    "margin": {
        "N001": "日期",
        "N002": "代码",
        "sc": "市场",
        "N003": "名称",
        "N004": "融资余额",
        "N005": "融券余额",
        "N006": "占流通市值%",
        "N008": "附加金额1",
        "N009": "附加金额2",
    },
    "new": {
        "N001": "日期",
        "N002": "代码",
        "sc": "市场",
        "N003": "名称",
        "N004": "发行价",
        "N005": "发行市盈率",
        "N007": "中签率",
        "N008": "募资额",
    },
    "capital": {"N001": "代码", "N002": "名称", "N003": "内容", "N004": "状态"},
}


def parse_market_payload(payload: dict, section: str) -> dict:
    if int(payload.get("ErrorCode") or 0) != 0:
        raise F10Error(f"7615 大盘资料返回错误码 {payload.get('ErrorCode')}")
    tables = payload.get("ResultSets") or []
    if not tables:
        return {"section": section, "rawColumns": [], "columns": [], "rows": [], "count": 0}
    table = tables[0]
    raw_columns = [str(name) for name in (table.get("ColName") or [])]
    labels = MARKET_LABELS.get(section, {})
    return {
        "section": section,
        "rawColumns": raw_columns,
        "columns": [labels.get(name, name) for name in raw_columns],
        "rows": table.get("Content") or [],
        "count": len(table.get("Content") or []),
    }


def fetch_market(section: str = "basic") -> dict:
    if section not in MARKET_SECTIONS:
        raise F10Error(f"不支持的大盘资料分区：{section}")
    entry, params = MARKET_SECTIONS[section]
    return parse_market_payload(_post_tqlex(entry, {"Params": params}), section)


def fetch_lhb_market() -> dict:
    """沪深龙虎榜（7615 大盘 F10，table0 含营业部买卖明细）。"""
    payload = _post_tqlex(
        "CWServ.skef10_dpzx_lhb",
        {"Params": ["001", "1", "20"]},
    )
    return parse_lhb_market_payload(payload)


def fetch_trading(code: str, section: str = "margin") -> dict:
    if section not in TRADING_SECTIONS:
        raise F10Error(f"不支持的交易数据分区：{section}")
    raw_section, arg = TRADING_SECTIONS[section]
    market, symbol = _market_of(code)
    if section == "margin_history":
        payload = _post_tqlex(
            "CWServ.tdxf10_gg_sj",
            {"Params": ["rzrq_sj", symbol, "0", symbol]},
        )
    else:
        payload = _post_tqlex(
            "CWServ.tdxf10_gg_jyds",
            {"Params": [symbol, raw_section, arg]},
        )
    table = parse_trading_payload(payload, section)
    if section == "dragon" and table["count"] == 0:
        # 个股 lgt 常返回空表；用大盘龙虎榜的同一批营业部明细按代码过滤补齐。
        market, symbol = _market_of(code)
        market_table = fetch_lhb_market()
        columns = market_table["columns"]
        code_index = columns.index("代码") if "代码" in columns else -1
        market_index = columns.index("市场") if "市场" in columns else -1
        rows = [
            row
            for row in market_table["rows"]
            if code_index >= 0
            and str(row[code_index]) == symbol
            and (market_index < 0 or int(row[market_index] or 0) == market)
        ]
        if rows:
            return {**table, "columns": columns, "rows": rows, "count": len(rows)}
    return table


def fetch_news(code: str) -> list[dict]:
    market, symbol = _market_of(code)
    body = {
        "action": "get",
        "key": f"xw:{market}_{symbol}",
        "bin": "1",
        "qsid": "tdx",
    }
    request = Request(
        f"{TQLEX_URL}?Entry=CWSearch.tzx_rcache",
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
        raise F10Error(f"7615 新闻请求失败：{error}") from error
    try:
        parsed = json.loads(raw.decode("utf-8-sig"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise F10Error("7615 新闻返回非 JSON") from error
    if not isinstance(parsed, dict):
        raise F10Error("7615 新闻返回结构异常")
    return parse_news_payload(parsed)


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
