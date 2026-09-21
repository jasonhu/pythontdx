/**
 * 自选股迷你走势图的数据源。
 *
 * 用什么数据画？
 *   用**日 K 的收盘价序列**（最近 30 个交易日），而不是当日分时。
 *   原因是成本：自选股里可能有十几只，每只都拉当日分时就是十几个请求；
 *   日 K 在右端有 60 秒缓存，而且这里 3 分钟才刷新一次，
 *   平均下来对上游几乎没有压力。
 *
 * 拉取策略：并发上限 3，单只失败不影响其它，先补齐缺的再统一刷新。
 */
import { createEffect, onCleanup, type Accessor } from 'solid-js'
import { createStore } from 'solid-js/store'
import { api } from '../lib/ipc'

/** 取多少个交易日 */
const POINTS = 30
/** 全量刷新周期 */
const REFRESH_MS = 3 * 60_000
/** 并发上限：既不让上游压力过大，也不至于串行等到天荒地老 */
const CONCURRENCY = 3

const [sparklines, setSparklines] = createStore<Record<string, number[]>>({})

export { sparklines }

export function sparklineOf(code: string): number[] | undefined {
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
        .kline({ code, period: 'day', count: POINTS })
        .then((series) => {
          const closes = series.bars.map((bar) => bar.close)
          if (!stopped && closes.length > 1) setSparklines(code, closes)
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

  createEffect(() => {
    enqueue(codes())
  })

  const timer = setInterval(() => enqueue(codes()), REFRESH_MS)

  onCleanup(() => {
    stopped = true
    clearInterval(timer)
  })
}
