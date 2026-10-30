"""HTTP API 的路由与错误处理测试；用 FakeBridge，不连真实行情。"""

import http.client
import json
import tempfile
import threading
import unittest
from pathlib import Path

from tdx_server import create_server


class FakeBridge:
    def close(self) -> None:
        pass

    def quotes(self, codes):
        return [{"code": code} for code in codes]

    def code_list(self):
        return [{"code": "sh600519"}]

    def category_quotes(self, **kwargs):
        return [{"code": "sh600519", "sortType": kwargs["sort_type"]}]

    def trades(self, code, **kwargs):
        return [{"code": code, "start": kwargs["start"]}]

    def auctions(self, code, **kwargs):
        return [{"code": code}]

    def money_flow(self, code):
        return [{"code": code, "date": "2026-10-30"}]

    def f10_catalog(self, code):
        return [{"name": "公司概况", "filename": "x.txt", "start": 0, "length": 1}]

    def f10_content(self, code, filename, start, length):
        return f"{code}:{filename}:{start}:{length}"

    def tdx_stats(self):
        return {"statCount": 8100, "statSamples": []}

    def tdx_stats_export(self):
        return {"statCount": 8100, "database": "/tmp/stats.db"}

    def stats_query(self, sql, limit):
        return {"columns": ["code"], "rows": [["600519"]], "rowCount": 1}

    def stats_csv(self):
        return {"statCsv": "/tmp/tdxstat.csv", "stat2Csv": "/tmp/tdxstat2.csv"}

    def blocks(self, kind):
        return {"kind": kind, "blockCount": 1, "blocks": [{"name": "测试板块"}]}

    def industries(self):
        return {"kind": "industry", "blockCount": 1, "blocks": [{"name": "银行"}]}

    def screen(self, filters):
        return {
            "scanned": 10,
            "matched": filters.get("minChangePct", 0),
            "quotes": [{"code": "sh600519"}],
        }


class TestHttpApi(unittest.TestCase):
    def setUp(self):
        self.server = create_server("127.0.0.1", 0, FakeBridge())
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.port = self.server.server_port

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)

    def request(self, method, path, body=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=3)
        headers = {}
        raw = None
        if body is not None:
            raw = json.dumps(body)
            headers["Content-Type"] = "application/json"
        connection.request(method, path, body=raw, headers=headers)
        response = connection.getresponse()
        payload = json.loads(response.read())
        headers = dict(response.getheaders())
        connection.close()
        return response.status, payload, headers

    def test_ping_and_cors(self):
        status, payload, headers = self.request("GET", "/api/ping")
        self.assertEqual(status, 200)
        self.assertEqual(payload, {"ok": True, "result": "pong"})
        self.assertEqual(headers.get("Access-Control-Allow-Origin"), "*")

    def test_quotes_post(self):
        status, payload, _ = self.request(
            "POST", "/api/quotes", {"codes": ["sh600519", "sz000858"]}
        )
        self.assertEqual(status, 200)
        self.assertEqual(
            [item["code"] for item in payload["result"]], ["sh600519", "sz000858"]
        )

    def test_category_and_trades(self):
        status, payload, _ = self.request(
            "POST", "/api/category", {"category": 6, "sortType": 14}
        )
        self.assertEqual(status, 200)
        self.assertEqual(payload["result"][0]["sortType"], 14)
        status, payload, _ = self.request(
            "POST", "/api/trades", {"code": "sh600519", "start": 60}
        )
        self.assertEqual(status, 200)
        self.assertEqual(payload["result"][0]["start"], 60)
        status, payload, _ = self.request("POST", "/api/stats_summary", {})
        self.assertEqual(status, 200)
        self.assertEqual(payload["result"]["statCount"], 8100)
        status, payload, _ = self.request("POST", "/api/stats_export", {})
        self.assertEqual(status, 200)
        self.assertEqual(payload["result"]["database"], "/tmp/stats.db")
        status, payload, _ = self.request(
            "POST", "/api/stats_query", {"sql": "SELECT code FROM tdxstat", "limit": 10}
        )
        self.assertEqual(status, 200)
        self.assertEqual(payload["result"]["rows"], [["600519"]])
        status, payload, _ = self.request("POST", "/api/stats_csv", {})
        self.assertEqual(status, 200)
        self.assertEqual(payload["result"]["statCsv"], "/tmp/tdxstat.csv")
        status, payload, _ = self.request("POST", "/api/blocks", {"kind": "gn"})
        self.assertEqual(status, 200)
        self.assertEqual(payload["result"]["blocks"][0]["name"], "测试板块")
        status, payload, _ = self.request("POST", "/api/industries", {})
        self.assertEqual(status, 200)
        self.assertEqual(payload["result"]["blocks"][0]["name"], "银行")
        status, payload, _ = self.request("POST", "/api/screen", {"minChangePct": 5})
        self.assertEqual(status, 200)
        self.assertEqual(payload["result"]["matched"], 5)

    def test_bad_json(self):
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=3)
        connection.request("POST", "/api/quotes", body="{", headers={"Content-Type": "application/json"})
        response = connection.getresponse()
        payload = json.loads(response.read())
        connection.close()
        self.assertEqual(response.status, 400)
        self.assertFalse(payload["ok"])

    def test_unknown_path(self):
        status, payload, _ = self.request("GET", "/api/nope")
        self.assertEqual(status, 404)
        self.assertFalse(payload["ok"])

    def test_sse_stream(self):
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        connection.request("GET", "/api/stream?codes=sh600519&interval=1000")
        response = connection.getresponse()
        self.assertEqual(response.status, 200)
        self.assertIn("text/event-stream", response.getheader("Content-Type", ""))
        line = response.readline().decode("utf-8")
        self.assertTrue(line.startswith("data: "), line)
        payload = json.loads(line[len("data: ") :])
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["result"]["quotes"][0]["code"], "sh600519")
        connection.close()


class TestStaticWeb(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        root = Path(self.directory.name)
        (root / "assets").mkdir()
        (root / "index.html").write_text("<h1>StockLens Web</h1>", encoding="utf-8")
        (root / "assets" / "app.js").write_text("console.log(1)", encoding="utf-8")
        self.server = create_server("127.0.0.1", 0, FakeBridge(), root)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        self.directory.cleanup()

    def get(self, path, method="GET"):
        connection = http.client.HTTPConnection(
            "127.0.0.1", self.server.server_port, timeout=3
        )
        connection.request(method, path)
        response = connection.getresponse()
        body = response.read()
        content_type = response.getheader("Content-Type", "")
        connection.close()
        return response.status, body, content_type

    def test_static_and_spa_fallback(self):
        status, body, content_type = self.get("/")
        self.assertEqual(status, 200)
        self.assertIn("StockLens Web", body.decode())
        self.assertIn("text/html", content_type)
        status, body, content_type = self.get("/assets/app.js")
        self.assertEqual(status, 200)
        self.assertIn("javascript", content_type)
        self.assertEqual(body, b"console.log(1)")
        status, body, _ = self.get("/assets/app.js", "HEAD")
        self.assertEqual(status, 200)
        self.assertEqual(body, b"")
        status, body, _ = self.get("/some/spa/route")
        self.assertEqual(status, 200)
        self.assertIn("StockLens Web", body.decode())
        status, _, _ = self.get("/%2e%2e/%2e%2e/etc/passwd")
        self.assertEqual(status, 403)


if __name__ == "__main__":
    unittest.main()
