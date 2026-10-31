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
    plans.append(
        {
            "type": "measure",
            "startDate": date_at(high if not up else low),
            "endDate": date_at(low if not up else high),
            "startPrice": high_price if not up else low_price,
            "endPrice": low_price if not up else high_price,
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

        # 通道的基准线由主摆动同侧点定义；趋势线取对侧摆动点，
        # 避免两条线完全重合，让用户能同时看到趋势与通道。
        trend_indices = [index for index in (highs if up else lows) if first <= index <= second]
        trend_start = trend_indices[0] if len(trend_indices) >= 2 else first
        trend_end = trend_indices[-1] if len(trend_indices) >= 2 else second
        trend_start_price = price_at(trend_start, "high" if up else "low")
        trend_end_price = price_at(trend_end, "high" if up else "low")
        if trend_end > trend_start and trend_end - trend_start >= 2:
            plans.append(
                {
                    "type": "trend",
                    "startDate": date_at(trend_start),
                    "endDate": date_at(trend_end),
                    "startPrice": trend_start_price,
                    "endPrice": trend_end_price,
                    "algorithm": ALGORITHM_VERSION,
                }
            )

        # 通道用最近 60 根的摆动定义，并延伸到最新一根，便于观察突破；
        # 主摆动斐波那契仍用原 lookback，二者用途不同。
        recent_start = max(0, len(bars) - 60)
        recent_highs, recent_lows = _pivots(bars, recent_start, len(bars) - 1)
        recent_high = max(range(recent_start, len(bars)), key=lambda i: price_at(i, "high"))
        recent_low = min(range(recent_start, len(bars)), key=lambda i: price_at(i, "low"))
        recent_up = recent_low < recent_high
        channel_start = recent_low if recent_up else recent_high
        channel_end_pivot = recent_high if recent_up else recent_low
        channel_pivots = [
            index
            for index in (recent_lows if recent_up else recent_highs)
            if channel_start < index < channel_end_pivot
        ]
        channel_first = channel_start
        channel_second = channel_pivots[-1] if channel_pivots else min(channel_end_pivot - 1, channel_first + 2)
        if channel_second > channel_first and channel_second < channel_end_pivot:
            channel_first_price = price_at(channel_first, "low" if recent_up else "high")
            channel_second_price = price_at(channel_second, "low" if recent_up else "high")
            latest = len(bars) - 1
            slope = (channel_second_price - channel_first_price) / (channel_second - channel_first)
            projected_end_price = channel_first_price + slope * (latest - channel_first)
            third_index = recent_high if recent_up else recent_low
            third_price = price_at(third_index, "high" if recent_up else "low")
            offset = channel_offset_at(
                channel_first,
                channel_first_price,
                channel_second,
                channel_second_price,
                third_index,
                third_price,
            )
            if offset is not None and abs(offset) > 0.01 and latest > channel_second:
                plans.append(
                    {
                        "type": "channel",
                        "startDate": date_at(channel_first),
                        "endDate": date_at(latest),
                        "startPrice": channel_first_price,
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

    # 箭头标出主摆动之后的阶段折返（下跌后的反弹高点 / 上涨后的回踩低点）
    later_pivots = [index for index in (highs if not up else lows) if index > swing_end]
    if later_pivots:
        arrow_end = later_pivots[-1]
        arrow_start = swing_end
        plans.append(
            {
                "type": "arrow",
                "startDate": date_at(arrow_start),
                "endDate": date_at(arrow_end),
                "startPrice": price_at(arrow_start, "low" if not up else "high"),
                "endPrice": price_at(arrow_end, "high" if not up else "low"),
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
