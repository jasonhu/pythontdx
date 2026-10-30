"""7615 在线公告解析测试（不依赖网络）。"""

import unittest

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

    def test_error_and_bad_code(self):
        with self.assertRaises(tdx_f10.F10Error):
            tdx_f10.parse_announcements_payload({"ErrorCode": 3, "ResultSets": []})
        with self.assertRaises(tdx_f10.F10Error):
            tdx_f10.fetch_announcements("600519")


if __name__ == "__main__":
    unittest.main()
