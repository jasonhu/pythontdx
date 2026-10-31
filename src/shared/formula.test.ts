import { describe, expect, it } from 'vitest'
import type { KLineBar } from './types'
import { backtestFormula, backtestPortfolio, evaluateFormula, FormulaError } from './formula'

function bars(closes: number[]): KLineBar[] {
  return closes.map((close, index) => ({
    date: `2026-01-0${index + 1}`,
    open: close - 0.5,
    high: close + 1,
    low: close - 1,
    close,
    volume: 100 + index
  }))
}

describe('evaluateFormula', () => {
  it('MA 与 REF', () => {
    const result = evaluateFormula('MA(CLOSE,3)', bars([1, 2, 3, 4, 5]))
    expect(result.values.slice(0, 2)).toEqual([Number.NaN, Number.NaN])
    expect(result.values.slice(2)).toEqual([2, 3, 4])
    expect(result.latest).toBe(4)
    const ref = evaluateFormula('REF(CLOSE,1)', bars([1, 2, 3]))
    expect(ref.values[0]).toBeNaN()
    expect(ref.values[2]).toBe(2)
  })

  it('EMA、算术与比较', () => {
    const ema = evaluateFormula('EMA(CLOSE,2)', bars([1, 2, 3]))
    expect(ema.values[0]).toBe(1)
    expect(ema.values[2]).toBeCloseTo(2.5556, 3)
    const mid = evaluateFormula('(HIGH+LOW)/2', bars([10]))
    expect(mid.latest).toBe(10)
    const compare = evaluateFormula('CLOSE > 2', bars([1, 2, 3]))
    expect(compare.values).toEqual([0, 0, 1])
  })

  it('SMA/WMA/COUNT/BARSLAST 支持常用通达信函数', () => {
    const sma = evaluateFormula('SMA(CLOSE,2,1)', bars([1, 2, 3]))
    expect(sma.values[0]).toBe(1)
    expect(sma.values[2]).toBeCloseTo(2.25, 6)
    const wma = evaluateFormula('WMA(CLOSE,3)', bars([1, 2, 3]))
    expect(wma.values[2]).toBeCloseTo(14 / 6, 6)
    expect(evaluateFormula('COUNT(CLOSE > 1, 3)', bars([1, 2, 3])).values[2]).toBe(2)
    expect(evaluateFormula('EVERY(CLOSE > 0, 2)', bars([1, 2, 3])).values[2]).toBe(1)
    expect(evaluateFormula('BARSLAST(CLOSE > 2)', bars([1, 3, 2, 4])).values[3]).toBe(0)
    expect(evaluateFormula('HHVBARS(HIGH, 3)', bars([1, 2, 3])).values[2]).toBe(0)
    expect(evaluateFormula('SQRT(CLOSE)', bars([9])).latest).toBe(3)
    expect(evaluateFormula('ROUND(1.6)', bars([1])).latest).toBe(2)
    expect(evaluateFormula('AND(CLOSE > 1, VOL > 0)', bars([2])).latest).toBe(1)
    expect(evaluateFormula('NOT(CLOSE > 1)', bars([2])).latest).toBe(0)
    const rsi = evaluateFormula('RSI(CLOSE,2)', bars([1, 2, 3]))
    expect(rsi.values[2]).toBe(100)
    expect(evaluateFormula('BIAS(CLOSE,2)', bars([1, 2, 3])).values[2]).toBeCloseTo(20, 6)
    expect(evaluateFormula('ATR(2)', bars([1, 2, 3])).values[2]).toBeCloseTo(2, 6)
  })

  it('CROSS 只在穿越那根为 1', () => {
    const cross = evaluateFormula('CROSS(CLOSE,2.5)', bars([1, 2, 3, 2, 4]))
    expect(cross.values).toEqual([0, 0, 1, 0, 1])
  })

  it('回测按上一根信号成交并计算收益/回撤', () => {
    const data = bars([10, 11, 12, 11])
    const result = evaluateFormula('CLOSE', data)
    const backtest = backtestFormula(result, data)
    expect(backtest.trades).toBe(1)
    expect(backtest.strategyReturn).toBeGreaterThan(0)
    expect(backtest.holdReturn).toBeGreaterThan(0)
    expect(backtest.maxDrawdown).toBeGreaterThanOrEqual(0)
    expect(Number.isFinite(backtest.annualizedReturn)).toBe(true)
    expect(backtest.winRate).toBe(0)
    expect(backtest.equity).toHaveLength(data.length)
  })

  it('回测吃到隔夜跳空（收盘到收盘，而非开盘到收盘）', () => {
    const data: KLineBar[] = [10, 20, 20].map((close, index) => ({
      date: `2026-02-0${index + 1}`,
      open: close,
      high: close,
      low: close,
      close,
      volume: 100
    }))
    const result = evaluateFormula('CLOSE', data)
    const backtest = backtestFormula(result, data)
    expect(backtest.holdReturn).toBeCloseTo(100, 1)
    expect(backtest.strategyReturn).toBeGreaterThan(90)
  })

  it('等权组合回测按日期平均收益', () => {
    const first = bars([10, 11, 12])
    const second = bars([20, 18, 22])
    const items = [
      { bars: first, result: evaluateFormula('CLOSE', first) },
      { bars: second, result: evaluateFormula('CLOSE', second) }
    ]
    const result = backtestPortfolio(items)
    expect(result.stocks).toBe(2)
    expect(result.days).toBe(2)
    expect(result.strategyReturn).toBeGreaterThan(0)
    expect(result.trades).toBe(2)
    expect(result.curve).toHaveLength(result.days + 1)
    expect(result.maxDrawdown).toBeGreaterThanOrEqual(0)
  })

  it('SUM/HHV/LLV/STD/IF 滚动函数', () => {
    const data = bars([1, 2, 3, 4, 5])
    expect(evaluateFormula('SUM(CLOSE,2)', data).latest).toBe(9)
    expect(evaluateFormula('HHV(CLOSE,3)', data).latest).toBe(5)
    expect(evaluateFormula('LLV(CLOSE,3)', data).latest).toBe(3)
    expect(evaluateFormula('STD(CLOSE,2)', data).latest).toBeCloseTo(0.5, 6)
    expect(evaluateFormula('IF(CLOSE > 3, 1, 0)', data).latest).toBe(1)
    expect(evaluateFormula('IF(CLOSE > 9, 1, 0)', data).latest).toBe(0)
  })

  it('未知变量/函数与空公式报错', () => {
    expect(() => evaluateFormula('FOO', bars([1]))).toThrow(FormulaError)
    expect(() => evaluateFormula('MA(CLOSE)', bars([1]))).toThrow(FormulaError)
    expect(() => evaluateFormula('', bars([1]))).toThrow(FormulaError)
  })
})
