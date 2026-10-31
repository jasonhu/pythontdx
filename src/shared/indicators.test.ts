import { describe, expect, it } from 'vitest'
import type { KLineBar } from './types'
import { boll, ema, kdj, macd, rsi, wr } from './indicators'

function bars(closes: number[]): KLineBar[] {
  return closes.map((close, index) => ({
    date: `2026-01-${String(index + 1).padStart(2, '0')}`,
    open: close,
    high: close + 1,
    low: close - 1,
    close,
    volume: 100
  }))
}

describe('indicators', () => {
  it('EMA/MACD 长度正确', () => {
    const data = bars([1, 2, 3, 4, 5])
    expect(ema([1, 2, 3], 2)).toHaveLength(3)
    const result = macd(data, 2, 3, 2)
    expect(result.dif).toHaveLength(5)
    expect(result.hist).toHaveLength(5)
  })

  it('RSI 对连续上涨为 100', () => {
    const values = rsi(bars([1, 2, 3, 4, 5]), 3)
    expect(values.at(-1)).toBe(100)
  })

  it('KDJ/BOLL 边界', () => {
    const result = kdj(bars([1, 2, 3, 4, 5]), 3)
    expect(result.k.at(-1)).toBeGreaterThan(0)
    const bands = boll(bars(Array.from({ length: 25 }, (_, i) => i + 1)), 20)
    expect(bands.middle.at(-1)).toBe(15.5)
    expect(bands.upper.at(-1)).toBeGreaterThan(bands.middle.at(-1)!)
  })
})

describe('wr', () => {
  it('计算 14 日威廉指标并保留前导空值', () => {
    const bars = Array.from({ length: 20 }, (_, index) => ({
      date: String(index),
      open: 10,
      high: 10 + index,
      low: 9 + index,
      close: 9.5 + index,
      volume: 1
    }))
    const values = wr(bars, 14)
    expect(Number.isNaN(values[12])).toBe(true)
    expect(values[13]).toBeTypeOf('number')
    expect(values[19]).toBeGreaterThanOrEqual(0)
    expect(values[19]).toBeLessThanOrEqual(100)
  })
})
