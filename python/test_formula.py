"""Python 公式引擎（后端选股）测试。"""

import unittest

import formula


def bars(closes):
    return [
        {"open": close, "high": close + 1, "low": close - 1, "close": close, "volume": 100}
        for close in closes
    ]


class TestFormula(unittest.TestCase):
    def test_ma_ref(self):
        data = bars([1, 2, 3, 4, 5])
        self.assertAlmostEqual(formula.evaluate_formula("MA(CLOSE,3)", data), 4.0)
        self.assertAlmostEqual(formula.evaluate_formula("REF(CLOSE,1)", data), 4.0)
        self.assertAlmostEqual(formula.evaluate_formula("(HIGH+LOW)/2", data), 5.0)

    def test_cross(self):
        data = bars([1, 2, 3, 2, 4])
        self.assertEqual(formula.evaluate_formula("CROSS(CLOSE,2.5)", data), 1.0)
        self.assertEqual(formula.evaluate_formula("CROSS(CLOSE,10)", data), 0.0)

    def test_ema(self):
        value = formula.evaluate_formula("EMA(CLOSE,2)", bars([1, 2, 3]))
        self.assertAlmostEqual(value, 2.555555, places=5)

    def test_errors(self):
        with self.assertRaises(formula.FormulaError):
            formula.evaluate_formula("FOO", bars([1]))
        with self.assertRaises(formula.FormulaError):
            formula.evaluate_formula("MA(CLOSE)", bars([1]))
        with self.assertRaises(formula.FormulaError):
            formula.evaluate_formula("", bars([1]))


if __name__ == "__main__":
    unittest.main()
