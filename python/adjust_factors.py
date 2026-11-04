"""本地复权系数：只从 0x000f 的标签 1 权息事件计算仿射变换。

公式来源：通达信 GBBQ 权息事件的公开字段语义。
  D=c1 每十股现金分红, P=c2 配股价, S=c3 每十股送转, R=c4 每十股配股
  m=(10+S+R)/10, c=(D-R*P)/10
  单次前复权: raw/m - c/m；单次后复权: raw*m + c
不复制 eltdx 源码，只按协议字段独立实现。
"""
from __future__ import annotations

from datetime import datetime


def _single(event: dict) -> tuple[float, float, float, float]:
    dividend = float(event.get("c1") or 0)
    rights_price = float(event.get("c2") or 0)
    bonus = float(event.get("c3") or 0)
    rights = float(event.get("c4") or 0)
    multiplier = (10.0 + bonus + rights) / 10.0
    if multiplier <= 0:
        raise ValueError("权息事件 m 必须大于 0")
    cash = (dividend - rights * rights_price) / 10.0
    return 1.0 / multiplier, -cash / multiplier, multiplier, cash


def _compose(transforms: list[tuple[float, float]]) -> tuple[float, float]:
    scale, offset = 1.0, 0.0
    for next_scale, next_offset in transforms:
        scale *= next_scale
        offset = offset * next_scale + next_offset
    return scale, offset


def _valid_date(value: str) -> bool:
    try:
        datetime.strptime(value, "%Y-%m-%d")
        return True
    except (TypeError, ValueError):
        return False


def build_factors(
    records: list[dict],
    *,
    anchor_date: str | None = None,
    start_date: str | None = None,
) -> list[dict]:
    groups: dict[str, list[dict]] = {}
    for record in records:
        if int(record.get("category") or 0) != 1:
            continue
        date = str(record.get("date") or "")
        if not _valid_date(date):
            continue
        if start_date and date < start_date:
            continue
        if anchor_date and date > anchor_date:
            continue
        groups.setdefault(date, []).append(record)

    dates = sorted(groups)
    rows: list[dict] = []
    for index, date in enumerate(dates):
        qfq_events: list[tuple[float, float]] = []
        for later in dates[index:]:
            qfq_events.extend((_single(event)[0], _single(event)[1]) for event in groups[later])
        hfq_events: list[tuple[float, float]] = []
        for earlier in reversed(dates[: index + 1]):
            hfq_events.extend((_single(event)[2], _single(event)[3]) for event in groups[earlier])
        qfq_scale, qfq_offset = _compose(qfq_events)
        hfq_scale, hfq_offset = _compose(hfq_events)
        rows.append(
            {
                "date": date,
                "qfqScale": qfq_scale,
                "qfqOffset": qfq_offset,
                "hfqScale": hfq_scale,
                "hfqOffset": hfq_offset,
                "eventCount": sum(len(groups[item]) for item in dates[index:]),
            }
        )
    return rows


def coefficient_for_bar(factors: list[dict], bar_date: str, mode: str) -> tuple[float, float]:
    if mode == "qfq":
        row = next((item for item in factors if bar_date < item["date"]), None)
        return (1.0, 0.0) if row is None else (row["qfqScale"], row["qfqOffset"])
    if mode == "hfq":
        row = next(
            (item for item in reversed(factors) if item["date"] <= bar_date), None
        )
        return (1.0, 0.0) if row is None else (row["hfqScale"], row["hfqOffset"])
    raise ValueError("mode 只支持 qfq / hfq")


def apply_factors(bars: list[dict], factors: list[dict], mode: str) -> list[dict]:
    adjusted: list[dict] = []
    for bar in bars:
        date = str(bar.get("date") or "")[:10]
        scale, offset = coefficient_for_bar(factors, date, mode)
        row = dict(bar)
        for field in ("open", "high", "low", "close"):
            if bar.get(field) is not None:
                row[field] = round(float(bar[field]) * scale + offset, 2)
        row["adjust"] = mode
        adjusted.append(row)
    return adjusted
