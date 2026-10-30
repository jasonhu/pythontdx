"""通达信桥接进程的解析测试。

fixture 是 2026-10-29 收盘后从 7709 主站抓的真实响应（hex）。
运行：python3 -m unittest discover -s python -p 'test_*.py'
"""

import unittest
from pathlib import Path

import tdx_bridge as tdx

FIXTURES = Path(__file__).parent / "fixtures"


def fixture(name: str) -> bytes:
    return bytes.fromhex((FIXTURES / f"{name}.hex").read_text(encoding="utf-8").strip())


SECURITIES = {
    "sh600519": {
        "code": "sh600519",
        "market": "SH",
        "symbol": "600519",
        "name": "贵州茅台",
        "decimal": 2,
        "kind": "GP-A",
    }
}


class TestCodec(unittest.TestCase):
    def test_varint_positive_and_negative(self):
        self.assertEqual(tdx.read_varint(b"\x05", 0), (5, 1))
        self.assertEqual(tdx.read_varint(b"\x45", 0), (-5, 1))
        self.assertEqual(tdx.read_varint(b"\x85\x01", 0), (69, 2))
        self.assertEqual(tdx.read_varint(b"\xc5\x01", 0), (-69, 2))

    def test_varint_truncated(self):
        with self.assertRaises(tdx.TdxError):
            tdx.read_varint(b"\x85", 0)

    def test_volume(self):
        self.assertEqual(tdx.decode_volume(0), 0.0)
        self.assertAlmostEqual(tdx.decode_volume(0x40000000), 2.0)
        self.assertAlmostEqual(tdx.decode_volume(0x3F800000), 1.0)

    def test_frame(self):
        frame = tdx.encode_frame(9, 0x053E, b"abc")
        self.assertEqual(len(frame), 15)
        self.assertEqual(frame[0], 0x0C)
        self.assertEqual(frame[5], 0x01)
        self.assertEqual(int.from_bytes(frame[6:8], "little"), 5)
        self.assertEqual(int.from_bytes(frame[10:12], "little"), 0x053E)

    def test_market_code(self):
        self.assertEqual(tdx.parse_code("sh600519"), (1, "600519"))
        self.assertEqual(tdx.parse_code("SZ000858"), (0, "000858"))
        with self.assertRaises(tdx.TdxError):
            tdx.parse_code("hk00700")

    def test_normalize_name(self):
        self.assertEqual(tdx.normalize_name("五 粮 液"), "五粮液")
        self.assertEqual(tdx.normalize_name("INTL  GENIUS"), "INTL GENIUS")


class TestQuotes(unittest.TestCase):
    def test_single_quote(self):
        quotes = tdx.parse_quotes(fixture("quote1"), 1_700_000_000_000, SECURITIES)
        self.assertEqual(len(quotes), 1)
        quote = quotes[0]
        self.assertEqual(quote["code"], "sh600519")
        self.assertEqual(quote["name"], "贵州茅台")
        self.assertAlmostEqual(quote["price"], 1354.0, places=2)
        self.assertAlmostEqual(quote["prevClose"], 1330.75, places=2)
        self.assertAlmostEqual(quote["open"], 1349.99, places=2)
        self.assertAlmostEqual(quote["high"], 1356.0, places=2)
        self.assertAlmostEqual(quote["low"], 1330.01, places=2)
        self.assertEqual(quote["volume"], 42992)
        self.assertAlmostEqual(quote["amount"], 5_797_980_160, delta=100_000)
        self.assertEqual(quote["bids"][0], {"price": 1353.77, "volume": 1})
        self.assertEqual(quote["asks"][0], {"price": 1354.0, "volume": 27})
        self.assertEqual(quote["time"], 1_700_000_000_000)

    def test_five_quotes_and_tail(self):
        quotes = tdx.parse_quotes(fixture("quote5"), 1, {})
        self.assertEqual(
            [quote["code"] for quote in quotes],
            ["sh600519", "sz000858", "sh600036", "sz300750", "sh600000"],
        )
        self.assertAlmostEqual(quotes[1]["price"], 72.28, places=2)
        self.assertAlmostEqual(quotes[2]["price"], 42.94, places=2)
        self.assertAlmostEqual(quotes[3]["price"], 229.07, places=2)

    def test_index_has_no_order_book(self):
        quotes = tdx.parse_quotes(fixture("quote-index"), 1, {})
        self.assertEqual(len(quotes), 1)
        self.assertEqual(quotes[0]["code"], "sh000001")
        self.assertAlmostEqual(quotes[0]["price"], 3651.43, places=2)
        self.assertEqual(quotes[0]["bids"], [])
        self.assertEqual(quotes[0]["asks"], [])


class TestBars(unittest.TestCase):
    def test_day_bars(self):
        bars = tdx.parse_bars(fixture("bars-day5"), "stock")
        self.assertEqual(len(bars), 5)
        self.assertEqual(bars[0]["date"], "2026-10-23")
        self.assertAlmostEqual(bars[0]["close"], 1335.0, places=2)
        self.assertAlmostEqual(bars[4]["open"], 1349.99, places=2)
        self.assertAlmostEqual(bars[4]["close"], 1354.0, places=2)
        self.assertAlmostEqual(bars[4]["volume"], 42992.0, delta=0.5)

    def test_week_bars(self):
        bars = tdx.parse_bars(fixture("bars-week3"), "stock")
        self.assertEqual([bar["date"] for bar in bars], ["2026-10-16", "2026-10-23", "2026-10-29"])
        self.assertAlmostEqual(bars[2]["close"], 1354.0, places=2)

    def test_index_bars_skip_extra_bytes(self):
        bars = tdx.parse_bars(fixture("bars-index3"), "index")
        self.assertEqual(len(bars), 3)
        self.assertEqual(
            [bar["date"] for bar in bars],
            ["2026-10-27", "2026-10-28", "2026-10-29"],
        )
        self.assertAlmostEqual(bars[2]["close"], 3651.43, places=2)


class TestMinutes(unittest.TestCase):
    def test_today_minute(self):
        trend = tdx.parse_today_minute(
            fixture("minute"),
            code="sh600519",
            name="贵州茅台",
            date="2026-10-29",
            prev_close=1330.75,
            decimal=2,
        )
        self.assertEqual(len(trend["points"]), 240)
        self.assertEqual(trend["points"][0]["time"], "09:31")
        self.assertAlmostEqual(trend["points"][0]["price"], 1334.65, places=2)
        self.assertAlmostEqual(trend["points"][0]["avg"], 1343.672, places=3)
        self.assertEqual(trend["points"][0]["volume"], 2416)
        self.assertEqual(trend["points"][-1]["time"], "15:00")
        self.assertAlmostEqual(trend["points"][-1]["price"], 1354.0, places=2)

    def test_history_minute(self):
        trend = tdx.parse_history_minute(
            fixture("minute-history"),
            code="sh600519",
            name="贵州茅台",
            date="2026-10-29",
            prev_close=0,
            decimal=2,
        )
        self.assertEqual(len(trend["points"]), 240)
        self.assertAlmostEqual(trend["prevClose"], 1330.75, places=2)
        self.assertAlmostEqual(trend["points"][0]["price"], 1334.65, places=2)
        self.assertAlmostEqual(trend["points"][-1]["price"], 1354.0, places=2)

    def test_minute_label(self):
        self.assertEqual(tdx.minute_label(0), "09:31")
        self.assertEqual(tdx.minute_label(119), "11:30")
        self.assertEqual(tdx.minute_label(120), "13:01")
        self.assertEqual(tdx.minute_label(239), "15:00")


class TestSecurityAndFinance(unittest.TestCase):
    def test_security_list(self):
        items = tdx.parse_security_list(fixture("list3"), 1)
        self.assertEqual(len(items), 3)
        self.assertEqual(items[0]["code"], "sh589610")
        self.assertEqual(items[0]["name"], "芯片指数")
        self.assertEqual(items[0]["market"], "SH")
        self.assertEqual(items[0]["decimal"], 3)
        self.assertEqual(items[0]["kind"], "JJ")

    def test_finance(self):
        items = tdx.parse_finance(fixture("finance2"))
        self.assertEqual(len(items), 2)
        maotai = next(item for item in items if item["code"] == "sh600519")
        self.assertAlmostEqual(maotai["floatShares"], 125008, delta=1)
        self.assertAlmostEqual(maotai["totalShares"], 125008, delta=1)
        self.assertAlmostEqual(maotai["eps"], 35.57, places=2)
        self.assertAlmostEqual(maotai["netAssetsPerShare"], 200.99, places=2)


if __name__ == "__main__":
    unittest.main()
