import struct
import tempfile
import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from tdx_local import LocalDayError, read_day_file, read_local_file


class TestLocalDay(unittest.TestCase):
    def test_read_day(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "sh600519.day"
            with path.open("wb") as handle:
                handle.write(struct.pack("<IIIIIfII", 20261029, 1000, 1100, 900, 1050, 1234.5, 10000, 0))
                handle.write(struct.pack("<IIIIIfII", 20261030, 1050, 1200, 1000, 1100, 2234.5, 20000, 0))
            result = read_day_file(str(path))
            self.assertEqual(result["count"], 2)
            self.assertEqual(result["bars"][0]["close"], 10.5)
            self.assertEqual(result["bars"][1]["volume"], 200)

    def test_read_lc1(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "sh600519.lc1"
            date = (2026 - 2004) * 2048 + 1030
            with path.open("wb") as handle:
                handle.write(struct.pack("<HHfffffII", date, 570, 10.0, 10.5, 9.8, 10.2, 12345.0, 10000, 0))
            result = read_local_file(str(path))
            self.assertEqual(result["count"], 1)
            self.assertEqual(result["firstDate"], "2026-10-30 09:30")
            self.assertEqual(result["bars"][0]["volume"], 100)

    def test_bad_length(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "bad.day"
            path.write_bytes(b"\x00" * 10)
            with self.assertRaises(LocalDayError):
                read_day_file(str(path))


if __name__ == "__main__":
    unittest.main()
