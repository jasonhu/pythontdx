import { describe, expect, it } from 'vitest'
import type { KLineBar } from './types'
import {
  bbi,
  boll,
  dma,
  ema,
  kdj,
  macd,
  rsi,
  wr,
  cci,
  bias,
  dmi,
  obv,
  roc,
  psy,
  vr,
  cr,
  trix,
  sar
} from './indicators'

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

describe('obv', () => {
  it('上涨加量、下跌减量', () => {
    const bars = [
      { date: '1', open: 10, high: 10, low: 10, close: 10, volume: 100 },
      { date: '2', open: 10, high: 11, low: 10, close: 11, volume: 200 },
      { date: '3', open: 11, high: 11, low: 9, close: 9, volume: 50 }
    ]
    expect(obv(bars)).toEqual([0, 200, 150])
  })
})

describe('roc / psy / vr / cr', () => {
  it('ROC 与 PSY 的前导和边界', () => {
    const rocValues = roc(bars([1, 2, 3, 4]), 2)
    expect(rocValues[0]).toBeNaN()
    expect(rocValues[1]).toBeNaN()
    expect(rocValues[2]).toBe(200)
    expect(rocValues[3]).toBe(100)
    const psyValues = psy(bars([1, 2, 1, 2]), 2)
    expect(psyValues[0]).toBeNaN()
    expect(psyValues[1]).toBeNaN()
    expect(psyValues[2]).toBe(50)
    expect(psyValues[3]).toBe(50)
  })

  it('VR 统计上涨/下跌/平盘量', () => {
    const data = [10, 11, 10, 10].map((close, index) => ({
      date: String(index),
      open: close,
      high: close + 1,
      low: close - 1,
      close,
      volume: (index + 1) * 100
    }))
    const values = vr(data, 2)
    expect(values[1]).toBeNaN()
    expect(values[2]).toBeCloseTo((200 / 300) * 100, 6)
    expect(values[3]).toBeCloseTo((200 / 500) * 100, 6)
  })

  it('CR 用昨收计算上下能量', () => {
    const data = [
      { close: 10, high: 11, low: 9 },
      { close: 12, high: 13, low: 10 },
      { close: 11, high: 12, low: 9 },
      { close: 13, high: 14, low: 10 }
    ].map((item, index) => ({
      date: String(index),
      open: item.close,
      high: item.high,
      low: item.low,
      close: item.close,
      volume: 100
    }))
    const values = cr(data, 2)
    expect(values[1]).toBeNaN()
    expect(values[2]).toBe(100)
    expect(values[3]).toBe(75)
  })

  it('BBI 是 MA3/6/12/24 的均值，前 23 根为 NaN', () => {
    const values = bbi(bars(Array.from({ length: 30 }, (_, index) => index + 1)))
    expect(values[22]).toBeNaN()
    expect(values[23]).toBeCloseTo(18.875, 6)
    expect(values[29]).toBeCloseTo(24.875, 6)
  })

  it('DMA 为短长均线差，AMA 再取 signal 日均值', () => {
    const values = dma(bars(Array.from({ length: 60 }, (_, index) => index + 1)), 3, 6, 3)
    expect(values.dma[4]).toBeNaN()
    expect(values.dma[5]).toBeCloseTo(1.5, 6)
    expect(values.dma[59]).toBeCloseTo(1.5, 6)
    expect(values.ama[6]).toBeNaN()
    expect(values.ama[7]).toBeCloseTo(1.5, 6)
    expect(values.ama[59]).toBeCloseTo(1.5, 6)
  })

  it('TRIX 对常数序列为 0，signal 预热后为 0；上涨序列为正', () => {
    const flat = trix(bars(Array.from({ length: 30 }, () => 10)), 3, 3)
    expect(flat.trix[0]).toBeNaN()
    expect(flat.trix[1]).toBe(0)
    expect(flat.signal[2]).toBeNaN()
    expect(flat.signal[3]).toBe(0)
    const rising = trix(bars(Array.from({ length: 30 }, (_, index) => index + 1)), 3, 3)
    expect(rising.trix.at(-1)).toBeGreaterThan(0)
  })

  it('SAR 上涨段在价格下方、下跌段在上方，长度与 bars 一致', () => {
    const up = sar(bars(Array.from({ length: 40 }, (_, index) => 10 + index)))
    const down = sar(bars(Array.from({ length: 40 }, (_, index) => 50 - index)))
    expect(up).toHaveLength(40)
    expect(down).toHaveLength(40)
    expect(up.at(-1)!).toBeLessThan(49)
    expect(down.at(-1)!).toBeGreaterThan(12)
    expect(up.every(Number.isFinite)).toBe(true)
    expect(down.every(Number.isFinite)).toBe(true)
  })
})
