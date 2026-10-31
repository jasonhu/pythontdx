import type { KLineBar } from './types'
import { channelOffsetAt } from './drawing'

/** 智能画线只描述几何，id/持久化字段由 K 线组件补齐。 */
export interface SmartDrawingPlan {
  type: 'fib' | 'trend' | 'channel' | 'horizontal'
  startIndex?: number
  startPrice?: number
  endIndex?: number
  endPrice?: number
  price?: number
  offset?: number
  extended?: boolean
}

function pivots(
  bars: readonly KLineBar[],
  from: number,
  to: number,
  k: number
): {
  highs: number[]
  lows: number[]
} {
  const highs: number[] = []
  const lows: number[] = []
  for (let index = from + k; index <= to - k; index += 1) {
    let isHigh = true
    let isLow = true
    for (let offset = 1; offset <= k; offset += 1) {
      if (
        bars[index].high < bars[index - offset].high ||
        bars[index].high < bars[index + offset].high
      ) {
        isHigh = false
      }
      if (
        bars[index].low > bars[index - offset].low ||
        bars[index].low > bars[index + offset].low
      ) {
        isLow = false
      }
    }
    if (isHigh) highs.push(index)
    if (isLow) lows.push(index)
  }
  return { highs, lows }
}

/**
 * 智能画线：取最近 lookback 根，找主要摆动高低点和摆动中枢，
 * 生成「斐波那契 + 趋势线 + 平行通道 + 水平支撑/压力」组合。
 * 数据不足或没有有效摆动时返回空数组，不猜。
 */
export function buildSmartDrawings(bars: readonly KLineBar[], lookback = 160): SmartDrawingPlan[] {
  if (bars.length < 24) return []
  const start = Math.max(0, bars.length - Math.max(40, lookback))
  const end = bars.length - 1
  let high = start
  let low = start
  for (let index = start; index <= end; index += 1) {
    if (bars[index].high > bars[high].high) high = index
    if (bars[index].low < bars[low].low) low = index
  }
  if (high === low || bars[high].high <= bars[low].low) return []

  const up = low < high
  const { highs, lows } = pivots(bars, start, end, 4)
  const plans: SmartDrawingPlan[] = []

  // 1. 主摆动斐波那契
  plans.push({
    type: 'fib',
    startIndex: up ? low : high,
    startPrice: up ? bars[low].low : bars[high].high,
    endIndex: up ? high : low,
    endPrice: up ? bars[high].high : bars[low].low,
    extended: false
  })

  // 2. 趋势线/通道用主摆动段的高低点，而不是最后两个小摆动点
  const swingStart = up ? low : high
  const swingEnd = up ? high : low
  const candidates = (up ? lows : highs).filter((index) => index > swingStart && index < swingEnd)
  const basePivots = [swingStart, ...candidates]
  const first = basePivots[0]
  const second =
    basePivots.length > 1 ? basePivots[basePivots.length - 1] : Math.min(swingEnd - 1, first + 2)
  if (second > first && second < swingEnd && second - first >= 2) {
    const firstPrice = up ? bars[first].low : bars[first].high
    const secondPrice = up ? bars[second].low : bars[second].high
    plans.push({
      type: 'trend',
      startIndex: first,
      startPrice: firstPrice,
      endIndex: second,
      endPrice: secondPrice
    })

    // 3. 平行通道：基准线穿过两个主摆动点，延伸到对侧极值，再把偏移线穿过极值
    const slope = (secondPrice - firstPrice) / (second - first)
    const projectedEndPrice = firstPrice + slope * (swingEnd - first)
    const thirdPrice = up ? bars[high].high : bars[low].low
    const offset = channelOffsetAt(first, firstPrice, second, secondPrice, swingEnd, thirdPrice)
    if (offset !== null && Math.abs(offset) > 0.01) {
      plans.push({
        type: 'channel',
        startIndex: first,
        startPrice: firstPrice,
        endIndex: swingEnd,
        endPrice: projectedEndPrice,
        offset
      })
    }
  }

  // 4. 最近摆动低点（上涨）或高点（下跌）的水平支撑/压力
  const horizontalPivot = up ? lows.at(-1) : highs.at(-1)
  if (horizontalPivot !== undefined) {
    plans.push({
      type: 'horizontal',
      price: up ? bars[horizontalPivot].low : bars[horizontalPivot].high
    })
  }

  return plans
}
