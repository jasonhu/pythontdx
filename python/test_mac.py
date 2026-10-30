"""MAC 0x122B 报价解析测试（离线，不连网）。"""
import struct
import unittest

import tdx_bridge
import tdx_mac


class TestMacQuotes(unittest.TestCase):
    def test_parse_quotes(self):
        bitmap = bytearray(20)
        for bit in tdx_mac.FIELD_BITS:
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
