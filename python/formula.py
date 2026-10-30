"""公式选股用的安全表达式引擎（与前端 shared/formula.ts 同一子集）。

支持 OPEN/HIGH/LOW/CLOSE/VOL、四则/比较、MA/EMA/REF/ABS/MAX/MIN/CROSS。
"""

from __future__ import annotations

import math
import re

SERIES = {
    "OPEN": "open",
    "HIGH": "high",
    "LOW": "low",
    "CLOSE": "close",
    "VOL": "volume",
    "VOLUME": "volume",
}
FUNCTIONS = {"MA", "EMA", "REF", "ABS", "MAX", "MIN", "CROSS"}


class FormulaError(Exception):
    pass


def _tokenize(text: str) -> list[tuple[str, str]]:
    tokens: list[tuple[str, str]] = []
    index = 0
    while index < len(text):
        char = text[index]
        if char.isspace():
            index += 1
            continue
        match = re.match(r"\d+(?:\.\d+)?", text[index:])
        if match:
            tokens.append(("num", match.group(0)))
            index += len(match.group(0))
            continue
        match = re.match(r"[A-Za-z_][A-Za-z0-9_]*", text[index:])
        if match:
            tokens.append(("id", match.group(0).upper()))
            index += len(match.group(0))
            continue
        two = text[index : index + 2]
        if two in {">=", "<=", "==", "<>"}:
            tokens.append(("op", "!=" if two == "<>" else two))
            index += 2
            continue
        if char in "+-*/(),<>":
            tokens.append(("op", char))
            index += 1
            continue
        raise FormulaError(f"无法识别字符：{char}")
    tokens.append(("eof", ""))
    return tokens


class _Parser:
    def __init__(self, tokens: list[tuple[str, str]]):
        self.tokens = tokens
        self.index = 0

    def peek(self) -> tuple[str, str]:
        return self.tokens[self.index]

    def take(self, value: str) -> bool:
        kind, token = self.peek()
        if kind == "op" and token == value:
            self.index += 1
            return True
        return False

    def parse(self):
        node = self.comparison()
        if self.peek()[0] != "eof":
            raise FormulaError("表达式末尾有多余内容")
        return node

    def comparison(self):
        left = self.additive()
        while self.peek()[0] == "op" and self.peek()[1] in {">", "<", ">=", "<=", "==", "!="}:
            op = self.peek()[1]
            self.index += 1
            left = ("binary", op, left, self.additive())
        return left

    def additive(self):
        left = self.multiplicative()
        while True:
            if self.take("+"):
                left = ("binary", "+", left, self.multiplicative())
            elif self.take("-"):
                left = ("binary", "-", left, self.multiplicative())
            else:
                return left

    def multiplicative(self):
        left = self.unary()
        while True:
            if self.take("*"):
                left = ("binary", "*", left, self.unary())
            elif self.take("/"):
                left = ("binary", "/", left, self.unary())
            else:
                return left

    def unary(self):
        if self.take("-"):
            return ("unary", "-", self.unary())
        if self.take("+"):
            return self.unary()
        return self.primary()

    def primary(self):
        kind, value = self.peek()
        if kind == "num":
            self.index += 1
            return ("number", float(value))
        if kind == "op" and value == "(":
            self.index += 1
            node = self.comparison()
            if not self.take(")"):
                raise FormulaError("缺少右括号")
            return node
        if kind == "id":
            self.index += 1
            if self.take("("):
                if value not in FUNCTIONS:
                    raise FormulaError(f"未知函数：{value}")
                args = []
                if not self.take(")"):
                    args.append(self.comparison())
                    while self.take(","):
                        args.append(self.comparison())
                    if not self.take(")"):
                        raise FormulaError(f"函数 {value} 缺少右括号")
                return ("call", value, args)
            if value not in SERIES:
                raise FormulaError(f"未知变量：{value}")
            return ("series", value)
        raise FormulaError("表达式不完整")


def _last_finite(values: list[float]) -> float:
    for value in reversed(values):
        if math.isfinite(value):
            return value
    return math.nan


def _count(node, bars) -> int:
    value = _last_finite(_evaluate(node, bars))
    count = int(value) if math.isfinite(value) else 0
    if count < 1:
        raise FormulaError("周期必须是正整数")
    return count


def _evaluate(node, bars: list[dict]) -> list[float]:
    kind = node[0]
    if kind == "number":
        return [node[1]] * len(bars)
    if kind == "series":
        key = SERIES[node[1]]
        return [float(bar.get(key) or 0.0) for bar in bars]
    if kind == "unary":
        return [-value for value in _evaluate(node[2], bars)]
    if kind == "binary":
        left = _evaluate(node[2], bars)
        right = _evaluate(node[3], bars)
        result = []
        for a, b in zip(left, right):
            op = node[1]
            if op == "+":
                result.append(a + b)
            elif op == "-":
                result.append(a - b)
            elif op == "*":
                result.append(a * b)
            elif op == "/":
                result.append(math.nan if b == 0 else a / b)
            elif op == ">":
                result.append(1.0 if a > b else 0.0)
            elif op == "<":
                result.append(1.0 if a < b else 0.0)
            elif op == ">=":
                result.append(1.0 if a >= b else 0.0)
            elif op == "<=":
                result.append(1.0 if a <= b else 0.0)
            elif op == "==":
                result.append(1.0 if a == b else 0.0)
            elif op == "!=":
                result.append(1.0 if a != b else 0.0)
            else:
                result.append(math.nan)
        return result
    name = node[1]
    args = node[2]
    if name == "MA":
        if len(args) != 2:
            raise FormulaError("MA 需要 2 个参数")
        values = _evaluate(args[0], bars)
        count = _count(args[1], bars)
        result = []
        for index in range(len(values)):
            if index + 1 < count:
                result.append(math.nan)
                continue
            window = values[index - count + 1 : index + 1]
            result.append(sum(window) / count if all(math.isfinite(v) for v in window) else math.nan)
        return result
    if name == "EMA":
        if len(args) != 2:
            raise FormulaError("EMA 需要 2 个参数")
        values = _evaluate(args[0], bars)
        count = _count(args[1], bars)
        alpha = 2 / (count + 1)
        previous = math.nan
        result = []
        for value in values:
            if not math.isfinite(previous):
                previous = value
            elif math.isfinite(value):
                previous = alpha * value + (1 - alpha) * previous
            result.append(previous)
        return result
    if name == "REF":
        if len(args) != 2:
            raise FormulaError("REF 需要 2 个参数")
        values = _evaluate(args[0], bars)
        count = _count(args[1], bars)
        return [values[index - count] if index >= count else math.nan for index in range(len(values))]
    if name == "ABS":
        if len(args) != 1:
            raise FormulaError("ABS 需要 1 个参数")
        return [abs(value) for value in _evaluate(args[0], bars)]
    if name in {"MAX", "MIN"}:
        if len(args) != 2:
            raise FormulaError(f"{name} 需要 2 个参数")
        left = _evaluate(args[0], bars)
        right = _evaluate(args[1], bars)
        return [max(a, b) if name == "MAX" else min(a, b) for a, b in zip(left, right)]
    if name == "CROSS":
        if len(args) != 2:
            raise FormulaError("CROSS 需要 2 个参数")
        left = _evaluate(args[0], bars)
        right = _evaluate(args[1], bars)
        result = [0.0] * len(left)
        for index in range(1, len(left)):
            if left[index] > right[index] and left[index - 1] <= right[index - 1]:
                result[index] = 1.0
        return result
    raise FormulaError(f"未知函数：{name}")


def evaluate_series(expression: str, bars: list[dict]) -> list[float]:
    text = expression.strip()
    if not text:
        raise FormulaError("公式不能为空")
    if len(text) > 200:
        raise FormulaError("公式过长（最多 200 字符）")
    if not bars:
        raise FormulaError("没有 K 线数据")
    return _evaluate(_Parser(_tokenize(text)).parse(), bars)


def evaluate_formula(expression: str, bars: list[dict]) -> float:
    values = evaluate_series(expression, bars)
    latest = values[-1] if values else math.nan
    if not math.isfinite(latest):
        raise FormulaError("公式最新值无有效数值")
    return latest
