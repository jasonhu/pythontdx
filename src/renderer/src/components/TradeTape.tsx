/**
 * 成交明细（0x0fc5 当日）。
 *
 * 每 3 秒拉一页最近 60 笔，按时间倒序显示；只做盘口旁边的「成交」页签。
 * 竞价快照（status=8）不是成交，弱化显示，不参与金额。
 */
import { createEffect, createSignal, For, onCleanup, onMount, Show, type JSX } from 'solid-js'
import type { TradeTick } from '@shared/types'
import { fixed, thousands } from '@shared/format'
import { api, errorMessage } from '../lib/ipc'

interface TradeTapeProps {
  code: string
}

const PAGE_SIZE = 60
const REFRESH_MS = 3000

export function TradeTape(props: TradeTapeProps): JSX.Element {
  const [ticks, setTicks] = createSignal<TradeTick[]>([])
  const [loading, setLoading] = createSignal(true)
  const [error, setError] = createSignal<string | null>(null)
  let requestId = 0

  const load = async (code: string): Promise<void> => {
    const current = ++requestId
    setLoading(true)
    try {
      const data = await api.trade.ticks({ code, count: PAGE_SIZE })
      if (current !== requestId) return
      setTicks(data)
      setError(null)
    } catch (cause) {
      if (current !== requestId) return
      setError(errorMessage(cause))
    } finally {
      if (current === requestId) setLoading(false)
    }
  }

  createEffect(() => {
    void load(props.code)
  })

  onMount(() => {
    const timer = window.setInterval(() => void load(props.code), REFRESH_MS)
    onCleanup(() => window.clearInterval(timer))
  })

  // 服务端一页是时间正序；盘口习惯把最新一笔放最上面
  const latestFirst = (): TradeTick[] => [...ticks()].reverse()

  return (
    <div class="tape">
      <div class="tape__meta">
        <span>{loading() ? '刷新中…' : `${ticks().length} 笔`}</span>
        <span>每 3 秒</span>
      </div>

      <Show when={error()}>
        {(message) => (
          <div class="tape__error" role="alert">
            {message()}
            <button class="tape__retry" onClick={() => void load(props.code)}>
              重试
            </button>
          </div>
        )}
      </Show>

      <div class="tape__head">
        <span>时间</span>
        <span class="tape__num">价格</span>
        <span class="tape__num">量</span>
        <span class="tape__side">方向</span>
      </div>

      <div class="tape__rows">
        <For each={latestFirst()}>
          {(tick) => (
            <div
              class="tape__row"
              classList={{
                'tape__row--auction': tick.eventKind === 'auction_snapshot',
                'tape__row--after': tick.status === 5
              }}
              title={`${tick.time} · ${tick.orderCount} 笔 · ${
                tick.eventKind === 'opening_match' ? '开盘撮合' : tick.eventKind
              }`}
            >
              <span class="tape__time num">{tick.time}</span>
              <span
                class="tape__price num"
                classList={{
                  'tone-up': tick.side === 'buy',
                  'tone-down': tick.side === 'sell'
                }}
              >
                {fixed(tick.price)}
              </span>
              <span class="tape__vol num">{thousands(tick.volume)}</span>
              <span class="tape__side">
                {tick.eventKind === 'auction_snapshot'
                  ? '竞价'
                  : tick.status === 5
                    ? '盘后'
                    : tick.side === 'buy'
                      ? 'B'
                      : tick.side === 'sell'
                        ? 'S'
                        : '—'}
              </span>
            </div>
          )}
        </For>
      </div>

      <Show when={!loading() && ticks().length === 0 && !error()}>
        <div class="tape__empty">暂无成交</div>
      </Show>
    </div>
  )
}
