"""K 线本地缓存读写测试；不依赖网络。"""

import os
import tempfile
import unittest
from pathlib import Path

import tdx_bridge


class TestKlineCache(unittest.TestCase):
    def setUp(self):
        self.previous = os.environ.get("PYTHONTDX_DATA_DIR")
        self.temp = tempfile.TemporaryDirectory()
        os.environ["PYTHONTDX_DATA_DIR"] = self.temp.name

    def tearDown(self):
        if self.previous is None:
            os.environ.pop("PYTHONTDX_DATA_DIR", None)
        else:
            os.environ["PYTHONTDX_DATA_DIR"] = self.previous
        self.temp.cleanup()

    def test_write_and_read_cache(self):
        bars = [
            {"date": "2026-10-30", "open": 10, "high": 11, "low": 9, "close": 10.5, "volume": 100}
        ]
        path = tdx_bridge._write_kline_cache("sh600519", "day", 30, "qfq", bars, "network")
        self.assertTrue(Path(path).exists())
        cached = tdx_bridge._read_kline_cache("sh600519", "day", 30, "qfq")
        self.assertIsNotNone(cached)
        self.assertEqual(cached["source"], "cache")
        self.assertEqual(cached["bars"][0]["close"], 10.5)

    def test_missing_cache_returns_none(self):
        self.assertIsNone(tdx_bridge._read_kline_cache("sh600519", "day", 99, "qfq"))
