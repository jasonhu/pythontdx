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


class TestCapitalChanges(unittest.TestCase):
    def test_parse_category_one_and_share_category(self):
        def record(category: int, values: tuple[float, float, float, float]) -> bytes:
            return (
                bytes([0])
                + b"000001"
                + b"\x00"
                + struct.pack("<I", 20200101)
                + bytes([category])
                + struct.pack("<4f", *values)
            )

        block = (
            bytes([0])
            + b"000001"
            + struct.pack("<H", 2)
            + record(1, (0, 3.56, 0, 1))
            + record(5, (0, 0, 2650, 4850))
        )
        body = struct.pack("<H", 1) + block
        blocks = tdx_bridge.parse_capital_changes(body)
        self.assertEqual(len(blocks), 1)
        self.assertEqual(blocks[0]["code"], "sz000001")
        self.assertEqual(blocks[0]["count"], 2)
        dividend = blocks[0]["records"][0]
        self.assertEqual(dividend["categoryName"], "除权除息")
        self.assertAlmostEqual(dividend["c2"], 3.56, places=2)
        self.assertEqual(dividend["c4"], 1)
        shares = blocks[0]["records"][1]
        self.assertEqual(shares["c3"], 26_500_000)
        self.assertEqual(shares["c4"], 48_500_000)


class TestFixedAdjustmentRequest(unittest.TestCase):
    def test_anchor_and_adjust_mode_are_encoded(self):
        body = tdx_bridge.bars_data(
            market=0,
            symbol="000001",
            period=4,
            count=3,
            adjust=3,
            start=0,
            period_param=1,
            anchor_date=20240603,
        )
        # <H market><6s code><H period><H param><H start><H count><H adjust><I anchor>
        offset = 2 + 6 + 2 + 2 + 2 + 2
        adjust, anchor = struct.unpack_from("<HI", body, offset)
        self.assertEqual(adjust, 3)
        self.assertEqual(anchor, 20240603)


class TestBlockMeta(unittest.TestCase):
    def test_request_and_parse(self):
        request = tdx_bridge.block_meta_data("block_zs.dat")
        self.assertEqual(len(request), 40)
        self.assertTrue(request.startswith(b"block_zs.dat"))
        md5 = "0123456789abcdef0123456789abcdef"
        body = struct.pack("<I", 1234) + b"\x00" + md5.encode("ascii") + b"\x00"
        meta = tdx_bridge.parse_block_meta(body)
        self.assertEqual(meta["size"], 1234)
        self.assertEqual(meta["md5"], md5)


if __name__ == "__main__":
    unittest.main()
