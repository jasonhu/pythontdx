"""P0 修复回归：keyed 归档分片、快照记录头校验、翻页不因短页截断。"""

from __future__ import annotations

import os
import struct
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import tdx_bridge
from code_archive import list_code_archives
from protocol_archive import write_dataset_archive


class TestKeyedArchive(unittest.TestCase):
    def test_two_keys_same_day_both_kept(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            first = tdx_bridge._write_keyed_archive(
                root,
                "category_quotes",
                "c6_s0",
                [{"code": "sh600000"}],
                source="test",
                trade_date="2026-11-04",
            )
            second = tdx_bridge._write_keyed_archive(
                root,
                "category_quotes",
                "c7_s0",
                [{"code": "sz000001"}],
                source="test",
                trade_date="2026-11-04",
            )
            self.assertFalse(first["skipped"])
            self.assertFalse(second["skipped"])
            self.assertEqual(len(list_code_archives(root)), 2)
            merged = tdx_bridge._merge_archive_lists(root, 50)
            self.assertEqual(len(merged), 2)

    def test_legacy_layout_still_listed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            write_dataset_archive(
                root,
                "category_quotes",
                [{"code": "sh600000"}],
                source="legacy",
                trade_date="2026-11-03",
            )
            tdx_bridge._write_keyed_archive(
                root,
                "category_quotes",
                "c6_s0",
                [{"code": "sh600000"}],
                source="test",
                trade_date="2026-11-04",
            )
            merged = tdx_bridge._merge_archive_lists(root, 50)
            self.assertEqual(len(merged), 2)

    def test_dataset_archive_corrupt_is_rebuilt(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            first = write_dataset_archive(
                root,
                "special_limits",
                [{"code": "sz000010"}],
                source="test",
                trade_date="2026-11-04",
            )
            self.assertFalse(first["skipped"])
            data = root / "trade_date=2026-11-04" / "special_limits.jsonl.gz"
            data.write_bytes(b"broken")
            second = write_dataset_archive(
                root,
                "special_limits",
                [{"code": "sz000010"}, {"code": "sz000011"}],
                source="test",
                trade_date="2026-11-04",
            )
            self.assertFalse(second["skipped"])
            self.assertEqual(second["rows"], 2)
            third = write_dataset_archive(
                root,
                "special_limits",
                [{"code": "sz000012"}],
                source="test",
                trade_date="2026-11-04",
            )
            self.assertTrue(third["skipped"])
            self.assertEqual(third["rows"], 2)

    def test_empty_rows_skipped(self):
        with tempfile.TemporaryDirectory() as directory:
            result = tdx_bridge._write_keyed_archive(
                Path(directory),
                "market_news",
                "tab3_p1",
                [],
                source="test",
                trade_date="2026-11-04",
            )
            self.assertTrue(result["skipped"])
            self.assertTrue(result.get("empty"))

    def test_key_sanitized(self):
        self.assertEqual(tdx_bridge._archive_key("sh600000/../../etc"), "sh600000_etc")


class TestSnapshotRecordHeader(unittest.TestCase):
    def test_single_foreign_record_uses_record_code(self):
        data = bytes([1]) + b"600519" + b"\x00" * 10
        records = tdx_bridge._split_quote_records(data, [(1, "000001")])
        self.assertEqual(len(records), 1)
        market, symbol, _ = records[0]
        self.assertEqual((market, symbol), (1, "600519"))

    def test_single_matching_record(self):
        data = bytes([1]) + b"600519" + b"\x00" * 10
        records = tdx_bridge._split_quote_records(data, [(1, "600519")])
        self.assertEqual(records[0][:2], (1, "600519"))

    def test_multiple_records_sorted_by_position(self):
        first = bytes([1]) + b"600000" + b"\x00" * 4
        second = bytes([0]) + b"000001" + b"\x00" * 4
        data = second + first  # 服务端顺序与请求顺序相反
        records = tdx_bridge._split_quote_records(
            data, [(1, "600000"), (0, "000001")]
        )
        self.assertEqual([item[:2] for item in records], [(0, "000001"), (1, "600000")])


class FakeConn:
    def __init__(self, responder):
        self.responder = responder
        self.calls = 0

    def request(self, *_args, **_kwargs):
        body = self.responder(self.calls)
        self.calls += 1
        return body

    def close(self):
        pass


class TestMinuteArchiveDate(unittest.TestCase):
    def test_weekend_uses_last_daily_date(self):
        bridge = tdx_bridge.Bridge.__new__(tdx_bridge.Bridge)
        bridge._raw_daily = lambda *args: [{"date": "2026-10-30", "close": 10.0}]
        bridge.minute = lambda code: {
            "date": "2026-11-04",
            "points": [{"time": "09:31", "price": 10.0, "avg": 10.0, "volume": 1}],
        }
        with tempfile.TemporaryDirectory() as directory:
            with mock.patch.dict(os.environ, {"PYTHONTDX_DATA_DIR": directory}):
                result = bridge.minute_archive_save("sh600000")
        self.assertEqual(result["date"], "2026-10-30")


class TestPaginationStopsOnEmpty(unittest.TestCase):
    def test_delisted_short_page_continues(self):
        pages = [
            [{"date": "2026-01-01"}],
            [{"date": "2026-01-02"}],
            [],
        ]
        calls = {"index": 0}

        def fake_parse(_body):
            index = min(calls["index"], len(pages) - 1)
            calls["index"] += 1
            return pages[index]

        bridge = tdx_bridge.Bridge.__new__(tdx_bridge.Bridge)
        bridge.conn = FakeConn(lambda _index: b"body")
        with mock.patch.object(tdx_bridge, "parse_delisted_bars", side_effect=fake_parse):
            with mock.patch.object(
                tdx_bridge.Bridge,
                "_delisted_code",
                return_value=(1, "600001"),
            ):
                result = bridge.delisted_history("sh600001", page_size=800)
        self.assertEqual(len(result["bars"]), 2)
        self.assertTrue(result["complete"])
        self.assertEqual(result["pages"], 2)

    def test_full_kline_short_page_continues(self):
        bars = [{"date": "2026-01-01"}, {"date": "2026-01-02"}]
        calls = {"index": 0}

        def fake_parse(_body, *_args):
            index = calls["index"]
            calls["index"] += 1
            return bars if index == 0 else []

        bridge = tdx_bridge.Bridge.__new__(tdx_bridge.Bridge)
        bridge.conn = FakeConn(lambda _index: b"body")
        with tempfile.TemporaryDirectory() as directory:
            with mock.patch.dict(os.environ, {"PYTHONTDX_DATA_DIR": directory}):
                with mock.patch.object(tdx_bridge, "parse_bars", side_effect=fake_parse):
                    with mock.patch.object(
                        tdx_bridge, "_write_full_kline_cache", return_value=Path(directory) / "x.parquet"
                    ):
                        result = bridge.full_kline("sh600519", "day", "none")
        self.assertEqual(len(result["bars"]), 2)
        self.assertTrue(result["complete"])
        self.assertEqual(result["pages"], 1)


if __name__ == "__main__":
    unittest.main()
