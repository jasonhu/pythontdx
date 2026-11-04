"""订阅 Hub：合并轮询、基线推送、错误隔离与取消；不联网。"""

from __future__ import annotations

import threading
import time
import unittest

from subscription_hub import SubscriptionHub


class TestSubscriptionHub(unittest.TestCase):
    def test_same_key_shares_one_poll(self):
        calls: list[int] = []
        lock = threading.Lock()

        def fetch(codes):
            with lock:
                calls.append(len(codes))
            return [{"code": codes[0], "price": 10.0}]

        hub = SubscriptionHub(fetch)
        first = hub.subscribe(["sh600519", "sz000001"], 200)
        second = hub.subscribe(["sz000001", "sh600519"], 200)  # 顺序不同但同一 Key
        time.sleep(0.55)
        hub.unsubscribe(first)
        hub.unsubscribe(second)
        # 3 个 200ms 周期 + 最多 1 次基线，远小于「每订阅各轮询」的 2 倍
        self.assertLessEqual(len(calls), 6)
        self.assertGreaterEqual(len(calls), 2)

    def test_baseline_and_fanout(self):
        def fetch(codes):
            return [{"code": code} for code in codes]

        hub = SubscriptionHub(fetch)
        first = hub.subscribe(["sh600519"], 1000)
        second = hub.subscribe(["sh600519"], 1000)
        payload_a = first.get(1.0)
        payload_b = second.get(1.0)
        hub.unsubscribe(first)
        hub.unsubscribe(second)
        self.assertTrue(payload_a["ok"])
        self.assertEqual(payload_a["result"]["quotes"][0]["code"], "sh600519")
        self.assertEqual(payload_b["result"]["quotes"][0]["code"], "sh600519")

    def test_error_is_isolated(self):
        state = {"fail": True}

        def fetch(codes):
            if state["fail"]:
                state["fail"] = False
                raise RuntimeError("boom")
            return [{"code": codes[0]}]

        hub = SubscriptionHub(fetch)
        sub = hub.subscribe(["sh600519"], 200)
        first = sub.get(0.5)
        second = sub.get(1.5)
        hub.unsubscribe(sub)
        self.assertFalse(first["ok"])
        self.assertIn("boom", first["error"])
        self.assertTrue(second["ok"])

    def test_unsubscribe_stops_task(self):
        def fetch(codes):
            return [{"code": codes[0]}]

        hub = SubscriptionHub(fetch)
        sub = hub.subscribe(["sh600519"], 100)
        hub.unsubscribe(sub)
        self.assertEqual(hub._tasks, {})

    def test_empty_codes_rejected(self):
        hub = SubscriptionHub(lambda codes: [])
        with self.assertRaises(ValueError):
            hub.subscribe([], 1000)


if __name__ == "__main__":
    unittest.main()
