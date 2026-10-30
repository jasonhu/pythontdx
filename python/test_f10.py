"""7615 在线公告解析测试（不依赖网络）。"""

import unittest
from unittest.mock import patch

import tdx_f10


class TestF10Announcements(unittest.TestCase):
    def test_parse(self):
        payload = {
            "ErrorCode": 0,
            "ResultSets": [
                {
                    "ColName": ["issue_date", "title", "rec_id", "typename", "source", "url"],
                    "Content": [
                        [
                            "2026-10-24 00:00:00",
                            "平安银行：2026年三季度报告",
                            "1225620609",
                            "三季度报告",
                            "深交所",
                            "http://example.test/a.pdf",
                        ]
                    ],
                }
            ],
        }
        rows = tdx_f10.parse_announcements_payload(payload)
        self.assertEqual(rows[0]["date"], "2026-10-24")
        self.assertEqual(rows[0]["title"], "平安银行：2026年三季度报告")
        self.assertEqual(rows[0]["url"], "http://example.test/a.pdf")

    def test_parse_profile(self):
        payload = {
            "ErrorCode": 0,
            "ResultSets": [
                {
                    "ColName": ["T035", "T031", "ssbk"],
                    "Content": [["A股", "1991-04-03", "深交所主板"]],
                }
            ],
        }
        table = tdx_f10.parse_profile_payload(payload)
        self.assertEqual(table["columns"], ["股票类别", "上市日期", "上市板块"])
        self.assertEqual(table["rows"][0][2], "深交所主板")

    def test_parse_valuation(self):
        payload = {
            "ErrorCode": 0,
            "ResultSets": [
                {"Content": [["5", "1211"]]},
                {
                    "ColDes": [{"Name": "DATE"}, {"Name": "PETTM"}, {"Name": "PBMRQ"}],
                    "Content": [["20261029", "5.15", "0.47"]],
                },
            ],
        }
        table = tdx_f10.parse_valuation_payload(payload)
        self.assertEqual(table["columns"], ["日期", "PE(TTM)", "PB(MRQ)"])
        self.assertEqual(table["rows"][0][1], "5.15")

    def test_parse_finance(self):
        payload = {
            "ErrorCode": 0,
            "ResultSets": [
                {
                    "ColName": ["T002", "mgsy", "jyr"],
                    "Content": [["2026-09-30", 0.6951, 13490000000]],
                }
            ],
        }
        table = tdx_f10.parse_finance_payload(payload)
        self.assertEqual(table["columns"], ["报告期", "每股收益", "净利润"])
        self.assertEqual(table["rows"][0][0], "2026-09-30")

    def test_parse_business(self):
        payload = {
            "ErrorCode": 0,
            "ResultSets": [
                {
                    "ColName": ["N000", "N001", "N002", "N003"],
                    "Content": [["按地区", 3, "总部", 38896000000]],
                }
            ],
        }
        table = tdx_f10.parse_business_payload(payload)
        self.assertEqual(table["columns"], ["分类", "项目", "营业收入"])
        self.assertEqual(table["rows"][0][1], "总部")

    def test_parse_shareholders(self):
        payload = {
            "ErrorCode": 0,
            "ResultSets": [
                {
                    "ColName": ["gd", "rq", "cgs", "bl", "lb", "xz"],
                    "Content": [["平安人寿", "2026-09-30", 440478714, 2.27, "保险", "流通A股"]],
                }
            ],
        }
        table = tdx_f10.parse_shareholder_payload(payload)
        self.assertEqual(table["columns"][0], "股东名称")
        self.assertEqual(table["rows"][0][2], 440478714)

    def test_parse_reports(self):
        payload = {
            "ErrorCode": 0,
            "ResultSets": [
                {
                    "ColName": ["T004", "T009", "T012", "T011", "T039"],
                    "Content": [["增持", "分析师", "20261026", 1, "点评标题"]],
                }
            ],
        }
        table = tdx_f10.parse_report_payload(payload)
        self.assertEqual(table["columns"], ["评级", "分析师", "日期", "记录ID", "标题"])
        self.assertEqual(table["rows"][0][-1], "点评标题")

    def test_parse_statement(self):
        payload = {
            "ErrorCode": 0,
            "ResultSets": [
                {
                    "ColName": ["rq", "T048", "T083", "T093"],
                    "Content": [["2026-09-30", 5952354000000, 5395653000000, 556701000000]],
                },
                {"ColName": ["rtype", "nhytype"], "Content": [["zcfzb", 1]]},
            ],
        }
        table = tdx_f10.parse_statement_payload(payload, "zcfzb")
        self.assertEqual(table["template"], 1)
        self.assertEqual(table["columns"][:2], ["报告期", "资产总计"])
        self.assertEqual(table["rows"][0][0], "2026-09-30")

    def test_parse_statement_full(self):
        payload = {
            "ErrorCode": 0,
            "ResultSets": [
                {"ColName": ["rq", "T048", "T083"], "Content": [["2026-09-30", 1, 2]]},
                {"ColName": ["rtype", "nhytype"], "Content": [["zcfzb", 1]]},
            ],
        }
        table = tdx_f10.parse_statement_payload(payload, "zcfzb", True)
        self.assertTrue(table["full"])
        self.assertEqual(table["columns"], ["rq", "T048", "T083"])

    def test_parse_news(self):
        payload = {
            "ErrorCode": 0,
            "ResultSets": [
                {
                    "ColName": ["issue_date", "title", "rec_id", "source"],
                    "Content": [["2026-10-29 21:56:27", "茅台新闻", "1", "证券时报"]],
                }
            ],
        }
        rows = tdx_f10.parse_news_payload(payload)
        self.assertEqual(rows[0]["date"], "2026-10-29 21:56")
        self.assertEqual(rows[0]["source"], "证券时报")

    def test_parse_trading(self):
        payload = {
            "ErrorCode": 0,
            "ResultSets": [
                {"ColName": ["T001", "T003"], "Content": [["20261029", "123"]]},
                {"ColName": ["other"], "Content": [["x"]]},
            ],
        }
        table = tdx_f10.parse_trading_payload(payload, "margin")
        self.assertEqual(table["count"], 1)
        self.assertEqual(table["columns"], ["交易日", "融资余额"])

    def test_parse_limit_up(self):
        payload = {
            "ErrorCode": 0,
            "ResultSets": [
                {
                    "ColName": ["lx", "sT002", "T011", "fdje", "zt", "yy", "N005"],
                    "Content": [["涨停", "2026-10-30", "09:25:01", 3780.86, "商业航天", "重整", 4565.78]],
                }
            ],
        }
        table = tdx_f10.parse_trading_payload(payload, "limit_up")
        self.assertEqual(table["count"], 1)
        self.assertIn("类型", table["columns"])
        self.assertIn("封单额", table["columns"])

    def test_fetch_shareholder_count_labels(self):
        payload = {
            "ErrorCode": 0,
            "ResultSets": [
                {
                    "ColName": ["T002", "T003", "T004", "T005", "T006", "T007", "T012"],
                    "Content": [["2026-06-30", 296404, 4217.49, 21.88, -18.1, 1185.49, 53245]],
                }
            ],
        }
        with patch.object(tdx_f10, "_post_tqlex", return_value=payload):
            table = tdx_f10.fetch_shareholder_count("sh600519")
        self.assertEqual(table["count"], 1)
        self.assertEqual(table["columns"][0], "报告期")
        self.assertEqual(table["columns"][1], "股东人数")
        self.assertEqual(table["columns"][6], "股东人数变动")

    def test_fetch_dividend_labels(self):
        payload = {
            "ErrorCode": 0,
            "ResultSets": [{"ColName": ["rq", "T004", "T036", "glzfl"], "Content": [["2025-12-31", "10派3元", "实施", 42.5]]}],
        }
        with patch.object(tdx_f10, "_post_tqlex", return_value=payload):
            table = tdx_f10.fetch_dividend("sh600519")
        self.assertEqual(table["count"], 1)
        self.assertEqual(table["columns"][0], "分红年度")
        self.assertEqual(table["columns"][1], "分红方案")
        self.assertEqual(table["columns"][3], "股利支付率%")

    def test_fetch_margin_history_uses_range_entry(self):
        payload = {
            "ErrorCode": 0,
            "ResultSets": [{"ColName": ["N001", "N002", "N004"], "Content": [["2026-04-30", "600519", 100]]}],
        }
        calls = []

        def fake(entry, body):
            calls.append((entry, body))
            return payload

        with patch.object(tdx_f10, "_post_tqlex", side_effect=fake):
            table = tdx_f10.fetch_trading("sh600519", "margin_history")
        self.assertEqual(table["count"], 1)
        self.assertEqual(calls[0][0], "CWServ.tdxf10_gg_sj")
        self.assertEqual(calls[0][1]["Params"][0], "rzrq_sj")

    def test_parse_market_margin(self):
        payload = {
            "ErrorCode": 0,
            "ResultSets": [
                {
                    "ColName": ["N001", "N002", "sc", "N003", "N004", "N005", "N006", "N008", "N009"],
                    "Content": [["2026-10-29", "603986", 1, "兆易创新", 100, 200, 7.78, 300, 400]],
                }
            ],
        }
        table = tdx_f10.parse_market_payload(payload, "margin")
        self.assertEqual(table["count"], 1)
        self.assertEqual(table["columns"][0], "日期")
        self.assertEqual(table["columns"][4], "融资余额")
        self.assertEqual(table["columns"][6], "占流通市值%")

    def test_parse_lhb_market(self):
        payload = {
            "ErrorCode": 0,
            "ResultSets": [
                {
                    "ColName": ["N001", "N002", "sc", "N003", "N004", "N005", "N008", "N009", "N010", "N011", "N012"],
                    "Content": [["10月30日周五", "000530", 0, "冰山冷热", 7.92, -3.76, "换手率达20%", "机构专用", 100, 50, "B"]],
                }
            ],
        }
        table = tdx_f10.parse_lhb_market_payload(payload)
        self.assertEqual(table["count"], 1)
        self.assertEqual(table["columns"][0], "日期")
        self.assertEqual(table["columns"][-1], "方向")

    def test_error_and_bad_code(self):
        with self.assertRaises(tdx_f10.F10Error):
            tdx_f10.parse_announcements_payload({"ErrorCode": 3, "ResultSets": []})
        with self.assertRaises(tdx_f10.F10Error):
            tdx_f10.fetch_announcements("600519")


if __name__ == "__main__":
    unittest.main()
