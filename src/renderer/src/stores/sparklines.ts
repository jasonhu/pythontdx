/**
 * 自选股迷你走势图的数据源。
 *
 * 用什么数据画？
 *   用**当日分时**（和主图一致的 1 分钟价格序列），不是日 K 收盘价。
 *
 * 原因：迷你走势图紧挨着「今日涨跌幅」这个数字，
 * 如果画的是最近 30 个交易日的趋势，就会出现
 * 「线是往下走的、旁边的数字却是 +1.09%」这种自相矛盾的画面，
 * 用户很容易误读成「今天在跌」。
 * 用当日分时之后，线的高度变化和旁边的百分比说的是同一件事。
 *
 * 成本：每只股票一个分时请求，主进程有 10 秒缓存，
 * 这里每分钟刷新一次 —— 相比行情轮询（每 3 秒一次批量请求）可以忽略。
 * 非交易时段数据不会变，直接跳过刷新。
 */
import { createEffect, onCleanup, type Accessor } from 'solid-js'
import { createStore } from 'solid-js/store'
import { isTradingNow } from '@shared/market'
import { downsample } from '../lib/chart-geometry'
import { api } from '../lib/ipc'

/** 迷你图只用这么多个点，多了在 46px 宽度上也看不出来 */
const MAX_POINTS = 60
/** 刷新周期 */
const REFRESH_MS = 60_000
/** 并发上限：既不给上游压力，也不至于串行等到天荒地老 */
const CONCURRENCY = 3

const [sparklines, setSparklines] = createStore<Record<string, SparklineData>>({})

export { sparklines }

/**
 * 迷你走势图的数据。
 * 除了价格序列，还要带上昨收 —— 线色由「现价 vs 昨收」决定，
 * 这样它和旁边那行涨跌幅永远是同一个颜色、同一个含义。
 */
export interface SparklineData {
  values: number[]
  prevClose: number
}

export function sparklineOf(code: string): SparklineData | undefined {
  return sparklines[code]
}

export function createSparklineLoader(codes: Accessor<string[]>): void {
  let stopped = false
  const queue: string[] = []
  let running = 0

  const pump = (): void => {
    while (running < CONCURRENCY && queue.length > 0) {
      const code = queue.shift()
      if (!code) break

      running++
      void api.trend
        .minute(code)
        .then((trend) => {
          const prices = trend.points.map((point) => point.price)
          if (!stopped && prices.length > 1) {
            setSparklines(code, {
              values: downsample(prices, MAX_POINTS),
              prevClose: trend.prevClose
            })
          }
        })
        // 单只失败就跳过，不能因为一只票把整列走势图拖垮
        .catch(() => undefined)
        .finally(() => {
          running--
          pump()
        })
    }
  }

  const enqueue = (list: string[]): void => {
    for (const code of list) {
      if (!queue.includes(code)) queue.push(code)
    }
    pump()
  }

  // 自选股变化时补齐缺失的走势图
  createEffect(() => {
    enqueue(codes())
  })

  const timer = setInterval(() => {
    // 非交易时段分时数据不会变，没必要重拉
    if (isTradingNow()) enqueue(codes())
  }, REFRESH_MS)

  onCleanup(() => {
    stopped = true
    clearInterval(timer)
  })
}
