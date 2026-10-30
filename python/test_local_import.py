import struct
import tempfile
import unittest
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from local_import import import_local_file


class TestLocalImport(unittest.TestCase):
    def test_import_deduplicates(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "sh600519.day"
            with source.open("wb") as handle:
                handle.write(struct.pack("<IIIIIfII", 20261029, 1000, 1100, 900, 1050, 1234.5, 10000, 0))
                handle.write(struct.pack("<IIIIIfII", 20261030, 1050, 1200, 1000, 1100, 2234.5, 20000, 0))
            root = Path(directory) / "data"
            first = import_local_file(str(source), root)
            second = import_local_file(str(source), root)
            self.assertEqual(first["code"], "sh600519")
            self.assertEqual(first["rows"], 2)
            self.assertEqual(second["totalRows"], 2)
            self.assertTrue(Path(second["jsonlPath"]).exists())
            self.assertTrue(Path(second["database"]).exists())


if __name__ == "__main__":
    unittest.main()
