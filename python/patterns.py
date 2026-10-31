"""轻量技术形态识别：摆动点、主趋势、通道、支撑压力。

纯函数，输入/输出都是普通 dict，便于数据挖掘、回测和 ML 复用。
输出使用日期锚点，不依赖前端下标。
"""
from __future__ import annotations

from datetime import datetime
from math import isfinite

ALGORITHM_VERSION = "swing-combo-v1"


def channel_offset_at(
    start_index: int,
    start_price: float,
    end_index: int,
    end_price: float,
    third_index: int,
    third_price: float,
) -> float | None:
    """第三点按自身横坐标投影到基准线，返回垂直价差。"""
    values = (start_index, start_price, end_index, end_price, third_index, third_price)
    if not all(isinstance(value, int | float) and isfinite(value) for value in values):
        return None
    if end_index == start_index:
        return None
    slope = (end_price - start_price) / (end_index - start_index)
    line_price = start_price + slope * (third_index - start_index)
    return third_price - line_price


def _pivots(bars: list[dict], start: int, end: int, window: int = 4) -> tuple[list[int], list[int]]:
    highs: list[int] = []
    lows: list[int] = []
    for index in range(start + window, end - window + 1):
        high = float(bars[index].get("high") or 0)
        low = float(bars[index].get("low") or 0)
        is_high = True
        is_low = True
        for offset in range(1, window + 1):
            if high < float(bars[index - offset].get("high") or 0) or high < float(
                bars[index + offset].get("high") or 0
            ):
                is_high = False
            if low > float(bars[index - offset].get("low") or 0) or low > float(
                bars[index + offset].get("low") or 0
            ):
                is_low = False
        if is_high:
            highs.append(index)
        if is_low:
            lows.append(index)
    return highs, lows


def build_smart_drawings(bars: list[dict], lookback: int = 160) -> list[dict]:
    """返回日期锚定的智能画线组合；数据不足时不猜。"""
    if len(bars) < 24:
        return []
    lookback = max(40, int(lookback))
    start = max(0, len(bars) - lookback)
    end = len(bars) - 1
    high = start
    low = start
    for index in range(start, end + 1):
        if float(bars[index].get("high") or 0) > float(bars[high].get("high") or 0):
            high = index
        if float(bars[index].get("low") or 0) < float(bars[low].get("low") or 0):
            low = index
    high_price = float(bars[high].get("high") or 0)
    low_price = float(bars[low].get("low") or 0)
    if high == low or high_price <= low_price:
        return []

    up = low < high
    swing_start = low if up else high
    swing_end = high if up else low
    highs, lows = _pivots(bars, start, end)
    plans: list[dict] = []

    def date_at(index: int) -> str:
        return str(bars[index].get("date") or "")

    def price_at(index: int, field: str) -> float:
        return float(bars[index].get(field) or 0)

    plans.append(
        {
            "type": "fib",
            "startDate": date_at(low if up else high),
            "endDate": date_at(high if up else low),
            "startPrice": low_price if up else high_price,
            "endPrice": high_price if up else low_price,
            "extended": False,
            "algorithm": ALGORITHM_VERSION,
        }
    )

    candidates = [index for index in (lows if up else highs) if swing_start < index < swing_end]
    base_indices = [swing_start, *candidates]
    first = base_indices[0]
    second = base_indices[-1] if len(base_indices) > 1 else min(swing_end - 1, first + 2)
    if second > first and second < swing_end and second - first >= 2:
        first_price = price_at(first, "low" if up else "high")
        second_price = price_at(second, "low" if up else "high")
        plans.append(
            {
                "type": "trend",
                "startDate": date_at(first),
                "endDate": date_at(second),
                "startPrice": first_price,
                "endPrice": second_price,
                "algorithm": ALGORITHM_VERSION,
            }
        )
        slope = (second_price - first_price) / (second - first)
        projected_end_price = first_price + slope * (swing_end - first)
        third_price = high_price if up else low_price
        offset = channel_offset_at(first, first_price, second, second_price, swing_end, third_price)
        if offset is not None and abs(offset) > 0.01:
            plans.append(
                {
                    "type": "channel",
                    "startDate": date_at(first),
                    "endDate": date_at(swing_end),
                    "startPrice": first_price,
                    "endPrice": projected_end_price,
                    "offset": offset,
                    "algorithm": ALGORITHM_VERSION,
                }
            )

    pivot_index = (lows if up else highs)[-1] if (lows if up else highs) else None
    if pivot_index is not None:
        plans.append(
            {
                "type": "horizontal",
                "price": price_at(pivot_index, "low" if up else "high"),
                "startDate": date_at(pivot_index),
                "algorithm": ALGORITHM_VERSION,
            }
        )

    for plan in plans:
        plan["score"] = 0.7
    return plans


def pattern_summary(plans: list[dict]) -> dict:
    """给数据湖/ML 任务用的稳定摘要。"""
    return {
        "algorithm": ALGORITHM_VERSION,
        "count": len(plans),
        "types": sorted({str(plan.get("type")) for plan in plans}),
        "generatedAt": datetime.now().astimezone().isoformat(timespec="seconds"),
    }
