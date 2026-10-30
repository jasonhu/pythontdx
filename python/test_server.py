"""HTTP API 的路由与错误处理测试；用 FakeBridge，不连真实行情。"""

import http.client
import json
import threading
import unittest

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


if __name__ == "__main__":
    unittest.main()
