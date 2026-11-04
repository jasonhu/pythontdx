"""0x0452 / 0x052b 协议解析与本地归档测试；不联网。"""

from __future__ import annotations

import json
import struct
import tempfile
import unittest
from pathlib import Path

import tdx_bridge
from delisted_archive import list_delisted_archives, write_delisted_archive
from protocol_archive import list_dataset_archives, write_dataset_archive


class TestSpecialLimits(unittest.TestCase):
    def test_parse_records(self):
        record = (
            bytes([0])
            + struct.pack("<I", 10)
            + struct.pack("<f", 1.68)
            + struct.pack("<f", 1.38)
        )
        body = struct.pack("<H", 1) + record
        rows = tdx_bridge.parse_special_limits(body)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["code"], "sz000010")
        self.assertAlmostEqual(rows[0]["limitUp"], 1.68, places=2)
        self.assertAlmostEqual(rows[0]["limitDown"], 1.38, places=2)

    def test_archive_keeps_first_snapshot(self):
        with tempfile.TemporaryDirectory() as directory:
            rows = [{"code": "sz000010", "limitUp": 1.68, "limitDown": 1.38}]
            first = write_dataset_archive(
                Path(directory),
                "special_limits",
                rows,
                source="test",
                trade_date="2026-11-04",
                fields=["code", "limitUp", "limitDown"],
            )
            second = write_dataset_archive(
                Path(directory),
                "special_limits",
                rows,
                source="test",
                trade_date="2026-11-04",
                fields=["code", "limitUp", "limitDown"],
            )
            self.assertFalse(first["skipped"])
            self.assertTrue(second["skipped"])
            manifest = json.loads(
                (Path(directory) / "trade_date=2026-11-04" / "manifest.json").read_text(
                    "utf-8"
                )
            )
            self.assertEqual(manifest["rows"], 1)
            self.assertEqual(len(list_dataset_archives(Path(directory))), 1)


class TestDelistedBars(unittest.TestCase):
    def test_parse_zero_record(self):
        record = struct.pack("<I", 20260105) + b"\x00" * 5
        record += struct.pack("<I", 0) + b"\x00" * 4
        body = struct.pack("<H", 1) + record
        bars = tdx_bridge.parse_delisted_bars(body)
        self.assertEqual(len(bars), 1)
        self.assertEqual(bars[0]["date"], "2026-01-05")
        self.assertEqual(bars[0]["amount"], 0)

    def test_archive_parquet_and_skip(self):
        with tempfile.TemporaryDirectory() as directory:
            bars = [
                {
                    "date": "2026-01-05",
                    "open": 1,
                    "high": 2,
                    "low": 0.5,
                    "close": 1.5,
                    "volume": 100,
                    "amount": 15000,
                }
            ]
            first = write_delisted_archive(Path(directory), "sz000038", bars)
            second = write_delisted_archive(Path(directory), "sz000038", bars)
            self.assertFalse(first["skipped"])
            self.assertTrue(second["skipped"])
            self.assertEqual(first["rows"], 1)
            self.assertTrue(Path(first["path"]).is_file())
            self.assertEqual(len(list_delisted_archives(Path(directory))), 1)


if __name__ == "__main__":
    unittest.main()
