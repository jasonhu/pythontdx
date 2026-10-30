"""MAC 0x122B 报价解析测试（离线，不连网）。"""
import json
import struct
import unittest

import tdx_bridge
import tdx_mac


class TestMacQuotes(unittest.TestCase):
    def test_parse_quotes(self):
        bitmap = bytearray(20)
        for bit in range(8):
            bitmap[bit // 8] |= 1 << (bit % 8)
        row = bytearray()
        row += struct.pack("<H", 1)
        row += b"600519".ljust(22, b"\x00")
        row += "贵州茅台".encode("gbk").ljust(44, b"\x00")
        values = [1354.0, 1363.0, 1393.37, 1352.98, 1392.05, 59927, 1.36, 8257381888.0]
        for index, value in enumerate(values):
            row += struct.pack("<I" if index == 5 else "<f", value)
        body = bytes(bitmap) + struct.pack("<IH", 1, 1) + bytes(row)
        quotes = tdx_mac.parse_quotes(body, 123)
        self.assertEqual(len(quotes), 1)
        quote = quotes[0]
        self.assertEqual(quote["code"], "sh600519")
        self.assertEqual(quote["name"], "贵州茅台")
        self.assertEqual(quote["price"], 1392.05)
        self.assertEqual(quote["volume"], 59927)
        self.assertAlmostEqual(quote["changePct"], 2.81, places=2)

    def test_parse_depth(self):
        bits = list(range(0, 8)) + [0x11, 0x12, 0x18, 0x19, 0x80, 0x86]
        bitmap = bytearray(20)
        for bit in bits:
            bitmap[bit // 8] |= 1 << (bit % 8)
        row = bytearray()
        row += struct.pack("<H", 1)
        row += b"600519".ljust(22, b"\x00")
        row += "贵州茅台".encode("gbk").ljust(44, b"\x00")
        values = [1354.0, 1363.0, 1393.37, 1352.98, 1392.05, 59927, 1.36, 8257381888.0, 1392.03, 1392.05, 2, 1, 1391.0, 2]
        for index, value in enumerate(values):
            row += struct.pack("<I" if index in (5, 10, 11, 13) else "<f", value)
        body = bytes(bitmap) + struct.pack("<IH", 1, 1) + bytes(row)
        quote = tdx_mac.parse_quotes(body, 123)[0]
        self.assertEqual(quote["bids"][0]["price"], 1392.03)
        self.assertEqual(quote["bids"][0]["volume"], 2)
        self.assertEqual(quote["asks"][0]["price"], 1392.05)

    def test_parse_capital_flow(self):
        raw = json.dumps([
            ["100", "40", "30", "20"],
            ["0", "0", "0", "70", "-5", "0"],
        ]).encode("gbk")
        flow = tdx_mac.parse_capital_flow(b"x" * 27 + raw)
        self.assertAlmostEqual(flow["mainNet"], 60.0)
        self.assertAlmostEqual(flow["retailNet"], 10.0)
        self.assertAlmostEqual(flow["largeNet5d"], 70.0)
        self.assertAlmostEqual(flow["midNet5d"], -5.0)

    def test_parse_unusual(self):
        record = bytearray()
        record += struct.pack("<H", 1)
        record += b"600519".ljust(6, b"\x00")
        record += struct.pack("<BBBHH", 0, 0x04, 0, 0, 0)
        record += struct.pack("<B2fI", 0, 0.025, 1.0, 0)
        record += b"\x00"
        record += struct.pack("<BH", 9, 2030)
        body = struct.pack("<H", 1) + bytes(record) + "贵州茅台".encode("gbk")
        items = tdx_mac.parse_unusual(body)
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["code"], "sh600519")
        self.assertEqual(items[0]["time"], "09:20:30")
        self.assertEqual(items[0]["desc"], "加速拉升")

    def test_empty_codes(self):
        self.assertEqual(tdx_mac.fetch_quotes([]), [])

    def test_bridge_falls_back_to_mac(self):
        bridge = object.__new__(tdx_bridge.Bridge)

        def fail(_codes):
            raise tdx_bridge.TdxError("7709 down")

        bridge._quotes_7709 = fail
        original = tdx_bridge.fetch_mac_quotes
        tdx_bridge.fetch_mac_quotes = lambda codes: [
            {"code": codes[0], "price": 1.0}
        ]
        try:
            quotes = bridge.quotes(["sh600519"])
        finally:
            tdx_bridge.fetch_mac_quotes = original
        self.assertEqual(quotes[0]["code"], "sh600519")


if __name__ == "__main__":
    unittest.main()
