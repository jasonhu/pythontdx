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

/** 乖离率 BIAS：收盘价相对 N 日均线的偏离百分比。 */
export function bias(bars: readonly KLineBar[], period = 6): number[] {
  const result: number[] = []
  for (let index = 0; index < bars.length; index += 1) {
    if (index < period - 1) {
      result.push(Number.NaN)
      continue
    }
    const window = bars.slice(index - period + 1, index + 1)
    const average = window.reduce((sum, bar) => sum + bar.close, 0) / period
    result.push(average === 0 ? 0 : ((bars[index].close - average) / average) * 100)
  }
  return result
}

/** DMI / ADX：+DI、-DI 与 ADX，Wilder 平滑。 */
export function dmi(
  bars: readonly KLineBar[],
  period = 14
): { plus: number[]; minus: number[]; adx: number[] } {
  const plus: number[] = []
  const minus: number[] = []
  const adx: number[] = []
  let smoothTr = 0
  let smoothPlus = 0
  let smoothMinus = 0
  let previousAdx = 0
  for (let index = 0; index < bars.length; index += 1) {
    if (index === 0) {
      plus.push(Number.NaN)
      minus.push(Number.NaN)
      adx.push(Number.NaN)
      continue
    }
    const bar = bars[index]
    const previous = bars[index - 1]
    const tr = Math.max(
      bar.high - bar.low,
      Math.abs(bar.high - previous.close),
      Math.abs(bar.low - previous.close)
    )
    const upMove = bar.high - previous.high
    const downMove = previous.low - bar.low
    const plusDm = upMove > downMove && upMove > 0 ? upMove : 0
    const minusDm = downMove > upMove && downMove > 0 ? downMove : 0
    if (index <= period) {
      smoothTr += tr
      smoothPlus += plusDm
      smoothMinus += minusDm
    } else {
      smoothTr = smoothTr - smoothTr / period + tr
      smoothPlus = smoothPlus - smoothPlus / period + plusDm
      smoothMinus = smoothMinus - smoothMinus / period + minusDm
    }
    if (index < period) {
      plus.push(Number.NaN)
      minus.push(Number.NaN)
      adx.push(Number.NaN)
      continue
    }
    const plusDi = smoothTr === 0 ? 0 : (smoothPlus / smoothTr) * 100
    const minusDi = smoothTr === 0 ? 0 : (smoothMinus / smoothTr) * 100
    plus.push(plusDi)
    minus.push(minusDi)
    const dx = plusDi + minusDi === 0 ? 0 : (Math.abs(plusDi - minusDi) / (plusDi + minusDi)) * 100
    if (index === period) {
      previousAdx = dx
      adx.push(dx)
    } else {
      previousAdx = (previousAdx * (period - 1) + dx) / period
      adx.push(previousAdx)
    }
  }
  return { plus, minus, adx }
}

/** OBV（能量潮）：按收盘涨跌累加/减去成交量。 */
export function obv(bars: readonly KLineBar[]): number[] {
  const result: number[] = []
  let value = 0
  for (let index = 0; index < bars.length; index += 1) {
    if (index > 0) {
      if (bars[index].close > bars[index - 1].close) value += bars[index].volume
      else if (bars[index].close < bars[index - 1].close) value -= bars[index].volume
    }
    result.push(value)
  }
  return result
}

/** ROC（变动率）：(收盘 - N 日前收盘) / N 日前收盘 × 100。 */
export function roc(bars: readonly KLineBar[], period = 12): number[] {
  return bars.map((bar, index) => {
    if (index < period) return Number.NaN
    const previous = bars[index - period].close
    return previous === 0 ? Number.NaN : ((bar.close - previous) / previous) * 100
  })
}

/** PSY（心理线）：N 个交易日中上涨天数占比，0~100。 */
export function psy(bars: readonly KLineBar[], period = 12): number[] {
  return bars.map((_, index) => {
    if (index < period) return Number.NaN
    let up = 0
    for (let cursor = index - period + 1; cursor <= index; cursor += 1) {
      if (bars[cursor].close > bars[cursor - 1].close) up += 1
    }
    return (up / period) * 100
  })
}

/**
 * VR（成交量比率）：(上涨量 + 平盘量/2) / (下跌量 + 平盘量/2) × 100。
 * 分母为 0 时没有下跌量，返回 `NaN` 让图表断线，而不是伪造一个有限值。
 */
export function vr(bars: readonly KLineBar[], period = 26): number[] {
  return bars.map((_, index) => {
    if (index < period) return Number.NaN
    let up = 0
    let down = 0
    let flat = 0
    for (let cursor = index - period + 1; cursor <= index; cursor += 1) {
      const volume = bars[cursor].volume
      if (bars[cursor].close > bars[cursor - 1].close) up += volume
      else if (bars[cursor].close < bars[cursor - 1].close) down += volume
      else flat += volume
    }
    const denominator = down + flat / 2
    return denominator === 0 ? Number.NaN : ((up + flat / 2) / denominator) * 100
  })
}

/** CR（能量指标）：(Σ max(最高-昨收,0) / Σ max(昨收-最低,0)) × 100。 */
export function cr(bars: readonly KLineBar[], period = 26): number[] {
  return bars.map((_, index) => {
    if (index < period) return Number.NaN
    let up = 0
    let down = 0
    for (let cursor = index - period + 1; cursor <= index; cursor += 1) {
      const previous = bars[cursor - 1].close
      up += Math.max(bars[cursor].high - previous, 0)
      down += Math.max(previous - bars[cursor].low, 0)
    }
    return down === 0 ? Number.NaN : (up / down) * 100
  })
}

/**
 * BBI（多空指数）：MA3/MA6/MA12/MA24 的平均。
 * 前 23 根没有 MA24，返回 NaN；之后四条均线的均值。
 */
export function bbi(bars: readonly KLineBar[]): number[] {
  const closes = bars.map((bar) => bar.close)
  const periods = [3, 6, 12, 24] as const
  const averages = periods.map((period) => {
    const result: number[] = []
    let sum = 0
    for (let index = 0; index < closes.length; index += 1) {
      sum += closes[index]
      if (index >= period) sum -= closes[index - period]
      result.push(index + 1 >= period ? sum / period : Number.NaN)
    }
    return result
  })
  return closes.map((_, index) => {
    const values = averages.map((series) => series[index])
    return values.every(Number.isFinite)
      ? values.reduce((total, value) => total + value, 0) / values.length
      : Number.NaN
  })
}
