/**
 * 分价表：把当日逐笔按成交价聚合，展示每个价位的成交量/笔数/占比。
 *
 * 只使用 0x0fc5 当日逐笔，不做估算；最多取 1800 笔。
 */
import { createEffect, createMemo, createSignal, For, Show, type JSX } from 'solid-js'
import type { TradeTick } from '@shared/types'
import { fixed, thousands } from '@shared/format'
import { api, errorMessage } from '../lib/ipc'

interface PriceRow {
  price: number
  volume: number
  count: number
  share: number
}

export function PriceDistribution(props: { code: string }): JSX.Element {
  const [ticks, setTicks] = createSignal<TradeTick[]>([])
  const [loading, setLoading] = createSignal(true)
  const [error, setError] = createSignal<string | null>(null)
  let requestId = 0

  createEffect(() => {
    const current = ++requestId
    setLoading(true)
    setError(null)
    void (async () => {
      try {
        const data = await api.trade.ticks({ code: props.code, count: 1800 })
        if (current !== requestId) return
        setTicks(data)
      } catch (cause) {
        if (current === requestId) setError(errorMessage(cause))
      } finally {
        if (current === requestId) setLoading(false)
      }
    })()
  })

  const rows = createMemo<PriceRow[]>(() => {
    const map = new Map<number, { volume: number; count: number }>()
    for (const tick of ticks()) {
      if (!Number.isFinite(tick.price) || tick.volume <= 0) continue
      const key = Math.round(tick.price * 100) / 100
      const item = map.get(key) ?? { volume: 0, count: 0 }
      item.volume += tick.volume
      item.count += 1
      map.set(key, item)
    }
    const total = [...map.values()].reduce((sum, item) => sum + item.volume, 0) || 1
    return [...map.entries()]
      .map(([price, item]) => ({
        price,
        volume: item.volume,
        count: item.count,
        share: (item.volume / total) * 100
      }))
      .sort((a, b) => b.price - a.price)
  })

  const maxVolume = createMemo(() => Math.max(1, ...rows().map((row) => row.volume)))
  const totalVolume = createMemo(() => rows().reduce((sum, row) => sum + row.volume, 0))

  return (
    <div class="price-dist">
      <Show when={!loading()} fallback={<div class="panel-empty">加载逐笔…</div>}>
        <Show when={!error()} fallback={<div class="panel-error">{error()}</div>}>
          <Show when={rows().length > 0} fallback={<div class="panel-empty">暂无成交</div>}>
            <div class="price-dist__head">
              <span>{rows().length} 个价位</span>
              <span>总量 {thousands(totalVolume())} 手</span>
            </div>
            <div class="price-dist__rows">
              <For each={rows()}>
                {(row) => (
                  <div class="price-dist__row">
                    <span class="num price-dist__price">{fixed(row.price)}</span>
                    <span class="price-dist__bar">
                      <span style={{ width: `${(row.volume / maxVolume()) * 100}%` }} />
                    </span>
                    <span class="num">{thousands(row.volume)}</span>
                    <span class="num price-dist__share">{fixed(row.share)}%</span>
                    <span class="num price-dist__count">{row.count} 笔</span>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </Show>
      </Show>
    </div>
  )
}
