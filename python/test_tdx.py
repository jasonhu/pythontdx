"""通达信桥接进程的解析测试。

fixture 是 2026-10-29 收盘后从 7709 主站抓的真实响应（hex）。
运行：python3 -m unittest discover -s python -p 'test_*.py'
"""

import gzip
import io
import json
import os
import sqlite3
import tempfile
import unittest
import zipfile
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


class TestSnapshotAndRefresh(unittest.TestCase):
    ITEMS = [(1, "600519"), (0, "000858")]

    def test_snapshot_request(self):
        data = tdx.quote_data(self.ITEMS)
        self.assertEqual(data[:8], tdx.QUOTE_LIST_PREFIX)
        self.assertEqual(int.from_bytes(data[8:10], "little"), 2)
        self.assertEqual(len(data), 10 + 7 * 2)

    def test_refresh_request_with_cursor(self):
        data = tdx.refresh_data(self.ITEMS, {"sh600519": 7})
        self.assertEqual(len(data), 2 + 11 * 2)
        self.assertEqual(int.from_bytes(data[:2], "little"), 2)
        self.assertEqual(data[2], 1)
        self.assertEqual(data[3:9], b"600519")
        self.assertEqual(int.from_bytes(data[9:13], "little"), 7)
        self.assertEqual(data[13], 0)
        self.assertEqual(data[14:20], b"000858")

    def test_snapshot_parser(self):
        quotes = tdx.parse_snapshots(
            fixture("snapshot2"), self.ITEMS, 1_700_000_000_000, SECURITIES
        )
        self.assertEqual([q["code"] for q in quotes], ["sh600519", "sz000858"])
        maotai = quotes[0]
        self.assertAlmostEqual(maotai["price"], 1372.0, places=2)
        self.assertAlmostEqual(maotai["prevClose"], 1354.0, places=2)
        self.assertAlmostEqual(maotai["open"], 1363.0, places=2)
        self.assertEqual(maotai["volume"], 15182)
        self.assertEqual(len(maotai["bids"]), 1)
        self.assertEqual(maotai["bids"][0], {"price": 1371.18, "volume": 1})
        self.assertEqual(maotai["asks"][0], {"price": 1372.27, "volume": 58})
        self.assertAlmostEqual(quotes[1]["price"], 73.91, places=2)

    def test_refresh_parser_five_levels(self):
        quotes = tdx.parse_refresh(
            fixture("refresh2"), self.ITEMS, 1_700_000_000_000, SECURITIES
        )
        self.assertEqual([q["code"] for q in quotes], ["sh600519", "sz000858"])
        maotai = quotes[0]
        self.assertAlmostEqual(maotai["price"], 1372.0, places=2)
        self.assertEqual(len(maotai["bids"]), 5)
        self.assertEqual(len(maotai["asks"]), 5)
        self.assertEqual(maotai["bids"][0], {"price": 1371.18, "volume": 1})
        self.assertEqual(maotai["bids"][4], {"price": 1370.3, "volume": 1})
        self.assertEqual(maotai["asks"][0], {"price": 1372.27, "volume": 58})


class TestCategoryQuotes(unittest.TestCase):
    def test_category_request(self):
        data = tdx.category_data(6, 0x000E, 0, 5, ascending=False, filter_raw=0)
        self.assertEqual(len(data), 18)
        values = [int.from_bytes(data[i : i + 2], "little") for i in range(0, 18, 2)]
        self.assertEqual(values, [6, 0x000E, 0, 5, 1, 5, 0, 1, 0])

    def test_category_parser(self):
        quotes = tdx.parse_category_quotes(
            fixture("category5"), 1_700_000_000_000, {}
        )
        self.assertEqual(len(quotes), 5)
        first = quotes[0]
        self.assertEqual(first["code"], "sh688066")
        self.assertAlmostEqual(first["price"], 5.57, places=2)
        self.assertAlmostEqual(first["prevClose"], 4.64, places=2)
        self.assertAlmostEqual(first["changePct"], 20.04, places=2)
        self.assertEqual(first["bids"][0]["price"], 5.57)
        self.assertEqual(first["asks"], [])
        self.assertGreater(first["lockedAmount"], 0)
        last = quotes[4]
        self.assertEqual(last["code"], "sz301079")
        self.assertEqual(last["asks"][0], {"price": 39.81, "volume": 61})


class TestTrades(unittest.TestCase):
    def test_today_request(self):
        data = tdx.trades_data(1, "600519", 0, 20)
        self.assertEqual(len(data), 12)
        self.assertEqual(data[:2], b"\x01\x00")
        self.assertEqual(data[2:8], b"600519")
        self.assertEqual(int.from_bytes(data[8:10], "little"), 0)
        self.assertEqual(int.from_bytes(data[10:12], "little"), 20)

    def test_history_request(self):
        data = tdx.trades_data(1, "600519", 0, 5, "2026-10-28")
        self.assertEqual(len(data), 16)
        self.assertEqual(int.from_bytes(data[:4], "little"), 20261028)
        self.assertEqual(int.from_bytes(data[4:6], "little"), 1)
        self.assertEqual(data[6:12], b"600519")

    def test_today_ticks(self):
        ticks = tdx.parse_trades(
            fixture("trades-today"), 1, "600519", 0, {}
        )
        self.assertEqual(len(ticks), 20)
        first = ticks[0]
        self.assertEqual(first["time"], "10:11")
        self.assertAlmostEqual(first["price"], 1370.68, places=2)
        self.assertEqual(first["volume"], 13)
        self.assertEqual(first["side"], "sell")
        self.assertEqual(first["eventKind"], "trade")

    def test_history_ticks(self):
        ticks = tdx.parse_trades(
            fixture("trades-history"), 1, "600519", 0, {}, "2026-10-28"
        )
        self.assertEqual(len(ticks), 5)
        first = ticks[0]
        self.assertEqual(first["time"], "15:06")
        self.assertAlmostEqual(first["price"], 1330.75, places=2)
        self.assertEqual(first["side"], "status_5")
        self.assertEqual(first["status"], 5)
        self.assertEqual(first["tradeAmount"], 133075.0)


class TestAuctions(unittest.TestCase):
    def test_auction_request(self):
        data = tdx.auction_data(1, "600519", None, 0, 0, 50)
        self.assertEqual(len(data), 28)
        self.assertEqual(data[:2], b"\x01\x00")
        self.assertEqual(data[2:8], b"600519")
        self.assertEqual(int.from_bytes(data[8:12], "little"), 0)
        self.assertEqual(int.from_bytes(data[12:16], "little"), 0)
        history = tdx.auction_data(1, "600519", "2026-10-28", 0, 0, 50)
        self.assertEqual(int.from_bytes(history[8:12], "little"), 20261028)
        self.assertEqual(tdx.auction_data(1, "600519")[12:16], b"\x00\x00\x00\x00")

    def test_auction_parser(self):
        points = tdx.parse_auctions(fixture("auction-today"))
        self.assertEqual(len(points), 50)
        first = points[0]
        self.assertEqual(first["time"], "09:15:02")
        self.assertEqual(first["timeSeconds"], 33302)
        self.assertAlmostEqual(first["price"], 1353.77, places=2)
        self.assertEqual(first["priceMilli"], 1353770)
        self.assertEqual(first["matchedVolume"], 16)
        self.assertEqual(first["unmatchedVolume"], 1)
        self.assertEqual(first["unmatchedDirection"], -1)
        self.assertEqual(points[-1]["time"], "09:20:01")

    def test_empty_auction(self):
        self.assertEqual(tdx.parse_auctions(b"\x00\x00"), [])


class TestFileRead(unittest.TestCase):
    def test_file_request(self):
        data = tdx.file_content_data("zhb.zip", 0, 64)
        self.assertEqual(len(data), 308)
        self.assertEqual(int.from_bytes(data[:4], "little"), 0)
        self.assertEqual(int.from_bytes(data[4:8], "little"), 64)
        self.assertEqual(data[8:15], b"zhb.zip")
        self.assertEqual(data[8 + tdx.FILE_PATH_FIELD - 1], 0)

    def test_file_path_normalization(self):
        data = tdx.file_content_data(r"tdx\zhb.zip", 0, 64)
        self.assertEqual(data[8:16], b"tdx/zhb.")
        with self.assertRaises(tdx.TdxError):
            tdx.file_content_data("中文.zip", 0, 64)
        with self.assertRaises(tdx.TdxError):
            tdx.file_content_data("zhb.zip", 0, 0)

    def test_file_chunk(self):
        chunk = tdx.parse_file_chunk(
            fixture("file-zhb-head"), "zhb.zip", 0, 64
        )
        self.assertEqual(chunk["chunkLen"], 64)
        self.assertTrue(chunk["contentHex"].startswith("504b0304"))
        self.assertFalse(chunk["isLast"])
        self.assertEqual(chunk["trailingBytes"], 0)

    def test_empty_file_chunk_is_last(self):
        chunk = tdx.parse_file_chunk(b"\x00\x00\x00\x00", "zhb.zip", 0, 64)
        self.assertEqual(chunk["chunkLen"], 0)
        self.assertTrue(chunk["isLast"])


class TestTdxStats(unittest.TestCase):
    def make_zip(self) -> bytes:
        stat = [""] * 35
        stat[0], stat[1] = "0", "000001"
        stat[2], stat[3], stat[4] = "1.23", "5.6", "20261029"
        stat[11], stat[26], stat[33] = "1000", "3", "2"
        stat2 = [""] * 21
        stat2[0], stat2[1], stat2[2] = "0", "000001", "20261029"
        stat2[3], stat2[4], stat2[14] = "1234.5", "10", "20"
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as archive:
            archive.writestr("tdxstat.cfg", "|".join(stat) + "\n")
            archive.writestr("tdxstat2.cfg", "|".join(stat2) + "\n")
        return buffer.getvalue()

    def test_parse_stats(self):
        result = tdx.parse_tdx_stats(self.make_zip())
        self.assertEqual(result["statCount"], 1)
        self.assertEqual(result["stat2Count"], 1)
        self.assertEqual(result["statsDate"], "20261029")
        self.assertEqual(result["statSamples"][0]["code"], "000001")
        self.assertAlmostEqual(result["statSamples"][0]["beta60"], 1.23)
        self.assertEqual(result["stat2Samples"][0]["sealAmount10k"], 10.0)

    def test_save_raw_file(self):
        with tempfile.TemporaryDirectory() as directory:
            old = os.environ.get("STOCKLENS_DATA_DIR")
            os.environ["STOCKLENS_DATA_DIR"] = directory
            try:
                saved = tdx.save_raw_file("x.bin", b"abc")
            finally:
                if old is None:
                    os.environ.pop("STOCKLENS_DATA_DIR", None)
                else:
                    os.environ["STOCKLENS_DATA_DIR"] = old
            self.assertEqual(saved["bytes"], 3)
            self.assertTrue(saved["savedTo"].endswith("raw/tdx/x.bin"))
            self.assertTrue(Path(saved["savedTo"]).exists())

    def test_export_stats_normalized(self):
        with tempfile.TemporaryDirectory() as directory:
            old = os.environ.get("STOCKLENS_DATA_DIR")
            os.environ["STOCKLENS_DATA_DIR"] = directory
            try:
                result = tdx.export_tdx_stats(self.make_zip())
            finally:
                if old is None:
                    os.environ.pop("STOCKLENS_DATA_DIR", None)
                else:
                    os.environ["STOCKLENS_DATA_DIR"] = old
            self.assertEqual(result["statCount"], 1)
            self.assertEqual(result["statSkipped"], 0)
            self.assertEqual(result["partitions"][0]["tradeDate"], "20261029")
            partition = Path(result["partitions"][0]["path"])
            self.assertTrue(Path(result["manifest"]).exists())
            with gzip.open(
                partition / "tdxstat.jsonl.gz", "rt", encoding="utf-8"
            ) as stream:
                lines = stream.read().splitlines()
            self.assertEqual(len(lines), 1)
            row = json.loads(lines[0])
            self.assertEqual(row["code"], "000001")
            self.assertAlmostEqual(row["beta60"], 1.23)
            database = sqlite3.connect(result["database"])
            try:
                count, beta = database.execute(
                    "SELECT COUNT(*), MAX(beta60) FROM tdxstat"
                ).fetchone()
                self.assertEqual(count, 1)
                self.assertAlmostEqual(beta, 1.23)
            finally:
                database.close()


class TestBlocks(unittest.TestCase):
    def test_parse_block_dat(self):
        data = fixture("block-gn-head")
        blocks = tdx.parse_block_dat(data, "gn")
        self.assertEqual(len(blocks), 1)
        self.assertEqual(blocks[0]["name"], "通达信88")
        self.assertEqual(blocks[0]["count"], 88)
        self.assertEqual(len(blocks[0]["codes"]), 88)
        self.assertEqual(blocks[0]["codes"][0], "000408")


class TestIndustry(unittest.TestCase):
    def test_parse_incon_sections(self):
        text = "#TDXNHY\nT01|能源\nT0101|煤炭\n######\n#SWHY\n110000|农业\n######\n"
        sections = tdx.parse_incon_sections(text)
        self.assertEqual(sections["TDXNHY"][0], ("T01", "能源"))
        self.assertEqual(sections["TDXNHY"][1], ("T0101", "煤炭"))
        self.assertEqual(sections["SWHY"][0], ("110000", "农业"))

    def test_parse_tdxhy(self):
        rows = tdx.parse_tdxhy(
            "0|000001|T1001|||X500102\n1|600519|T020301|||X3201\n#comment\n"
        )
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]["symbol"], "000001")
        self.assertEqual(rows[0]["tdxCode"], "T1001")
        self.assertEqual(rows[0]["rsCode"], "X500102")
        self.assertEqual(rows[1]["tdxCode"], "T020301")

    def test_parse_sector_indices(self):
        rows = tdx.parse_sector_indices(
            "银行|880471|2|1|1|T1001\n黑龙江|880201|3|1|0|1\nbadline\n"
        )
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]["code"], "sh880471")
        self.assertEqual(rows[0]["tdxCode"], "T1001")
        self.assertEqual(rows[1]["name"], "黑龙江")

    def test_sector_index_code(self):
        self.assertTrue(tdx.is_index_code(1, "880471"))
        self.assertTrue(tdx.is_index_code(1, "881001"))
        self.assertFalse(tdx.is_index_code(1, "600519"))


class TestScreenIndustry(unittest.TestCase):
    def test_filter_codes(self):
        quotes = [{"code": "sh600519"}, {"code": "sz000001"}]
        self.assertEqual(
            tdx.filter_quotes_by_codes(quotes, {"sh600519"}),
            [{"code": "sh600519"}],
        )


class TestStatsQuery(unittest.TestCase):
    def test_readonly_query(self):
        with tempfile.TemporaryDirectory() as directory:
            old = os.environ.get("STOCKLENS_DATA_DIR")
            os.environ["STOCKLENS_DATA_DIR"] = directory
            try:
                folder = Path(directory) / "normalized" / "tdx" / "zhb_stats"
                folder.mkdir(parents=True)
                database = sqlite3.connect(folder / "stats.db")
                database.execute("CREATE TABLE tdxstat (code TEXT, pe_ttm REAL)")
                database.execute("INSERT INTO tdxstat VALUES ('600519', 20.79)")
                database.execute("CREATE TABLE tdxstat2 (code TEXT, amount_10k REAL)")
                database.execute("INSERT INTO tdxstat2 VALUES ('600519', 1234.5)")
                database.commit()
                database.close()

                result = tdx.run_stats_query("SELECT code, pe_ttm FROM tdxstat", 10)
                self.assertEqual(result["columns"], ["code", "pe_ttm"])
                self.assertEqual(result["rows"], [["600519", 20.79]])
                exported = tdx.export_stats_csv()
                self.assertEqual(exported["statCount"], 1)
                self.assertEqual(exported["stat2Count"], 1)
                with open(exported["statCsv"], encoding="utf-8-sig") as stream:
                    lines = stream.read().splitlines()
                self.assertEqual(lines[0], "code,pe_ttm")
                self.assertEqual(lines[1], "600519,20.79")
                with self.assertRaises(tdx.TdxError):
                    tdx.run_stats_query("DELETE FROM tdxstat")
                with self.assertRaises(tdx.TdxError):
                    tdx.run_stats_query("SELECT 1; SELECT 2")
            finally:
                if old is None:
                    os.environ.pop("STOCKLENS_DATA_DIR", None)
                else:
                    os.environ["STOCKLENS_DATA_DIR"] = old


class TestScreener(unittest.TestCase):
    QUOTES = [
        {"code": "sh600519", "price": 1367.85, "changePct": 1.2, "amount": 3e9, "turnoverRate": 0.5, "amplitude": 2, "pb": 8.0, "floatCap": 20_000, "totalCap": 21_000},
        {"code": "sz300750", "price": 232.0, "changePct": 5.5, "amount": 8e9, "turnoverRate": 3.2, "amplitude": 6, "pb": 5.0, "floatCap": 8_000, "totalCap": 9_000},
        {"code": "sz000001", "price": 11.5, "changePct": -2.0, "amount": 1e8, "turnoverRate": 1.1, "amplitude": 3, "pb": 0.7, "floatCap": 2_000, "totalCap": 2_100},
        {"code": "sh688001", "price": 50.0, "changePct": 8.0, "amount": 2e8},
    ]

    def test_filter_and_sort(self):
        result = tdx.apply_screen(
            self.QUOTES,
            {"minChangePct": 3, "minAmount": 1e8, "sortBy": "changePct", "limit": 10},
        )
        self.assertEqual([row["code"] for row in result], ["sh688001", "sz300750"])

    def test_fundamental_filters(self):
        result = tdx.apply_screen(
            self.QUOTES,
            {"maxPb": 2, "maxFloatCap": 3_000, "maxTotalCap": 3_000, "sortBy": "amount"},
        )
        self.assertEqual([row["code"] for row in result], ["sz000001"])

    def test_missing_metric_excluded(self):
        result = tdx.apply_screen(
            self.QUOTES, {"minTurnoverRate": 1.0, "sortBy": "amount"}
        )
        self.assertEqual([row["code"] for row in result], ["sz300750", "sz000001"])

    def test_sort_by_pb_ascending_missing_last(self):
        result = tdx.apply_screen(self.QUOTES, {"sortBy": "pb", "ascending": True})
        self.assertEqual(
            [row["code"] for row in result],
            ["sz000001", "sz300750", "sh600519", "sh688001"],
        )

    def test_sort_by_total_cap_descending_missing_last(self):
        result = tdx.apply_screen(self.QUOTES, {"sortBy": "totalCap"})
        self.assertEqual(
            [row["code"] for row in result],
            ["sh600519", "sz300750", "sz000001", "sh688001"],
        )


class TestMoneyFlow(unittest.TestCase):
    def test_money_flow_request(self):
        data = tdx.money_flow_data(1, "600519")
        self.assertEqual(len(data), 38)
        self.assertEqual(data[:2], b"\x01\x00")
        self.assertEqual(data[2:8], b"600519")

    def test_money_flow_parser(self):
        records = tdx.parse_money_flow(fixture("money-flow-5"))
        self.assertEqual(len(records), 5)
        first = records[0]
        self.assertEqual(first["code"], "sh600519")
        self.assertEqual(first["date"], "2026-10-30")
        self.assertAlmostEqual(first["totalAmount"], 2_817_544_192.0, delta=1)
        self.assertAlmostEqual(first["mainNet"], 143_356_648.49, places=2)
        self.assertAlmostEqual(first["mainRatio"], 5.088, places=3)
        self.assertEqual(len(first["buckets"]), 16)
        self.assertEqual(first["buckets"][:4], [17301, 15350, 12329, 6470])


class TestF10(unittest.TestCase):
    def test_f10_requests(self):
        catalog = tdx.f10_catalog_data(1, "600519")
        self.assertEqual(len(catalog), 12)
        self.assertEqual(catalog[:2], b"\x01\x00")
        self.assertEqual(catalog[2:8], b"600519")
        content = tdx.f10_content_data(1, "600519", "600519.txt", 0, 200)
        self.assertEqual(len(content), 102)
        self.assertEqual(content[10:20], b"600519.txt")
        self.assertEqual(int.from_bytes(content[90:94], "little"), 0)
        self.assertEqual(int.from_bytes(content[94:98], "little"), 200)

    def test_f10_catalog(self):
        sections = tdx.parse_f10_catalog(fixture("f10-cat2"))
        self.assertEqual(len(sections), 2)
        self.assertEqual(sections[0]["name"], "最新提示")
        self.assertEqual(sections[0]["filename"], "600519.txt")
        self.assertEqual(sections[0]["start"], 0)
        self.assertEqual(sections[0]["length"], 15488)
        self.assertEqual(sections[1]["name"], "公司概况")

    def test_f10_content(self):
        text = tdx.parse_f10_content(fixture("f10-content200"))
        self.assertTrue(text.startswith("最新提示☆"))
        self.assertIn("贵州茅台", text)


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



class TestLimitPercent(unittest.TestCase):
    def test_board_limits(self):
        from tdx_bridge import limit_percent

        self.assertEqual(limit_percent("sh600000", "浦发银行"), 10)
        self.assertEqual(limit_percent("sz300001", "特锐德"), 20)
        self.assertEqual(limit_percent("sh688001", "华兴源创"), 20)
        self.assertEqual(limit_percent("bj920001", "北交所"), 30)
        self.assertEqual(limit_percent("sh600001", "ST测试"), 5)


if __name__ == "__main__":
    unittest.main()
