/**
 * 常用技术指标（纯函数，供指标面板使用）。
 *
 * 只做本地计算，不发请求；数组长度与 bars 一致，前导不足处为 NaN。
 */
import type { KLineBar } from './types'

export function ema(values: number[], period: number): number[] {
  const result: number[] = []
  const alpha = 2 / (period + 1)
  let previous = Number.NaN
  for (const value of values) {
    if (!Number.isFinite(previous)) previous = value
    else previous = alpha * value + (1 - alpha) * previous
    result.push(previous)
  }
  return result
}

export function macd(
  bars: readonly KLineBar[],
  fast = 12,
  slow = 26,
  signal = 9
): { dif: number[]; dea: number[]; hist: number[] } {
  const closes = bars.map((bar) => bar.close)
  const fastEma = ema(closes, fast)
  const slowEma = ema(closes, slow)
  const dif = closes.map((_, index) => fastEma[index] - slowEma[index])
  const dea = ema(dif, signal)
  const hist = dif.map((value, index) => (value - dea[index]) * 2)
  return { dif, dea, hist }
}

export function rsi(bars: readonly KLineBar[], period = 14): number[] {
  const result: number[] = [Number.NaN]
  let averageGain = 0
  let averageLoss = 0
  for (let index = 1; index < bars.length; index += 1) {
    const change = bars[index].close - bars[index - 1].close
    const gain = Math.max(0, change)
    const loss = Math.max(0, -change)
    if (index <= period) {
      averageGain += gain / period
      averageLoss += loss / period
      result.push(
        index === period
          ? averageLoss === 0
            ? 100
            : 100 - 100 / (1 + averageGain / averageLoss)
          : Number.NaN
      )
    } else {
      averageGain = (averageGain * (period - 1) + gain) / period
      averageLoss = (averageLoss * (period - 1) + loss) / period
      result.push(averageLoss === 0 ? 100 : 100 - 100 / (1 + averageGain / averageLoss))
    }
  }
  return result
}

export function kdj(
  bars: readonly KLineBar[],
  period = 9,
  m1 = 3,
  m2 = 3
): { k: number[]; d: number[]; j: number[] } {
  const k: number[] = []
  const d: number[] = []
  const j: number[] = []
  let previousK = 50
  let previousD = 50
  for (let index = 0; index < bars.length; index += 1) {
    const start = Math.max(0, index - period + 1)
    const window = bars.slice(start, index + 1)
    const highest = Math.max(...window.map((bar) => bar.high))
    const lowest = Math.min(...window.map((bar) => bar.low))
    const rsv = highest === lowest ? 50 : ((bars[index].close - lowest) / (highest - lowest)) * 100
    previousK = ((m1 - 1) / m1) * previousK + (1 / m1) * rsv
    previousD = ((m2 - 1) / m2) * previousD + (1 / m2) * previousK
    k.push(previousK)
    d.push(previousD)
    j.push(3 * previousK - 2 * previousD)
  }
  return { k, d, j }
}

export function boll(
  bars: readonly KLineBar[],
  period = 20,
  multiplier = 2
): { upper: number[]; middle: number[]; lower: number[] } {
  const closes = bars.map((bar) => bar.close)
  const upper: number[] = []
  const middle: number[] = []
  const lower: number[] = []
  for (let index = 0; index < closes.length; index += 1) {
    if (index + 1 < period) {
      upper.push(Number.NaN)
      middle.push(Number.NaN)
      lower.push(Number.NaN)
      continue
    }
    const window = closes.slice(index - period + 1, index + 1)
    const mean = window.reduce((sum, value) => sum + value, 0) / period
    const variance = window.reduce((sum, value) => sum + (value - mean) ** 2, 0) / period
    const deviation = Math.sqrt(variance) * multiplier
    middle.push(mean)
    upper.push(mean + deviation)
    lower.push(mean - deviation)
  }
  return { upper, middle, lower }
}

export function lastFinite(values: readonly number[]): number | null {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    if (Number.isFinite(values[index])) return values[index]
  }
  return null
}

/** 威廉指标 WR：0~100，数值越大越超卖（国内常用口径）。 */
export function wr(bars: readonly KLineBar[], period = 14): number[] {
  const result: number[] = []
  for (let index = 0; index < bars.length; index += 1) {
    if (index < period - 1) {
      result.push(Number.NaN)
      continue
    }
    const window = bars.slice(index - period + 1, index + 1)
    const highest = Math.max(...window.map((bar) => bar.high))
    const lowest = Math.min(...window.map((bar) => bar.low))
    result.push(
      highest === lowest ? 50 : ((highest - bars[index].close) / (highest - lowest)) * 100
    )
  }
  return result
}

/** CCI（顺势指标）：(典型价 - 均值) / (0.015 × 平均绝对偏差)，无固定上下界。 */
export function cci(bars: readonly KLineBar[], period = 14): number[] {
  const result: number[] = []
  const typical = bars.map((bar) => (bar.high + bar.low + bar.close) / 3)
  for (let index = 0; index < bars.length; index += 1) {
    if (index < period - 1) {
      result.push(Number.NaN)
      continue
    }
    const window = typical.slice(index - period + 1, index + 1)
    const average = window.reduce((sum, value) => sum + value, 0) / period
    const deviation = window.reduce((sum, value) => sum + Math.abs(value - average), 0) / period
    result.push(deviation === 0 ? 0 : (typical[index] - average) / (0.015 * deviation))
  }
  return result
}
