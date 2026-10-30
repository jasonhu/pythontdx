import { describe, expect, it } from 'vitest'
import type { KLineBar } from './types'
import { evaluateFormula, FormulaError } from './formula'

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

  it('CROSS 只在穿越那根为 1', () => {
    const cross = evaluateFormula('CROSS(CLOSE,2.5)', bars([1, 2, 3, 2, 4]))
    expect(cross.values).toEqual([0, 0, 1, 0, 1])
  })

  it('未知变量/函数与空公式报错', () => {
    expect(() => evaluateFormula('FOO', bars([1]))).toThrow(FormulaError)
    expect(() => evaluateFormula('MA(CLOSE)', bars([1]))).toThrow(FormulaError)
    expect(() => evaluateFormula('', bars([1]))).toThrow(FormulaError)
  })
})
