import { describe, expect, it } from 'vitest'
import type { KLineBar } from './types'
import { boll, ema, kdj, macd, rsi, wr, cci, bias, dmi } from './indicators'

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

describe('cci', () => {
  it('计算 CCI 并保留前导空值', () => {
    const bars = Array.from({ length: 20 }, (_, index) => ({
      date: String(index),
      open: 10,
      high: 11 + index,
      low: 9 + index,
      close: 10.5 + index,
      volume: 1
    }))
    const values = cci(bars, 14)
    expect(Number.isNaN(values[12])).toBe(true)
    expect(values[13]).toBeTypeOf('number')
    expect(Number.isFinite(values[19])).toBe(true)
  })
})

describe('bias', () => {
  it('计算 BIAS 并保留前导空值', () => {
    const bars = Array.from({ length: 12 }, (_, index) => ({
      date: String(index),
      open: 10,
      high: 10,
      low: 10,
      close: 10 + index,
      volume: 1
    }))
    const values = bias(bars, 6)
    expect(Number.isNaN(values[4])).toBe(true)
    expect(values[5]).toBeGreaterThan(0)
  })
})

describe('dmi', () => {
  it('输出 +DI/-DI/ADX 且前导为 NaN', () => {
    const bars = Array.from({ length: 40 }, (_, index) => ({
      date: String(index),
      open: 10 + index * 0.1,
      high: 11 + index * 0.2,
      low: 9 + index * 0.1,
      close: 10.5 + index * 0.15,
      volume: 1
    }))
    const values = dmi(bars, 14)
    expect(Number.isNaN(values.plus[12])).toBe(true)
    expect(values.plus[14]).toBeTypeOf('number')
    expect(values.adx[39]).toBeGreaterThanOrEqual(0)
    expect(values.adx[39]).toBeLessThanOrEqual(100)
  })
})
