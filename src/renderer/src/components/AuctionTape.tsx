/**
 * 集合竞价过程（0x056a）。
 *
 * 每 3 秒拉当日快照；虚拟匹配量不是真实成交，只用于观察竞价过程。
 */
import { createEffect, createSignal, For, onCleanup, onMount, Show, type JSX } from 'solid-js'
import type { AuctionPoint } from '@shared/types'
import { fixed, thousands } from '@shared/format'
import { api, errorMessage } from '../lib/ipc'

interface AuctionTapeProps {
  code: string
}

const REFRESH_MS = 3000

export function AuctionTape(props: AuctionTapeProps): JSX.Element {
  const [rows, setRows] = createSignal<AuctionPoint[]>([])
  const [loading, setLoading] = createSignal(true)
  const [error, setError] = createSignal<string | null>(null)
  const [date, setDate] = createSignal('')
  let requestId = 0

  const load = async (code: string, tradingDate = date()): Promise<void> => {
    const current = ++requestId
    setLoading(true)
    try {
      const data = await api.auction.series(code, tradingDate || undefined)
      if (current !== requestId) return
      setRows(data)
      setError(null)
    } catch (cause) {
      if (current !== requestId) return
      setError(errorMessage(cause))
    } finally {
      if (current === requestId) setLoading(false)
    }
  }

  createEffect(() => {
    const tradingDate = date()
    void load(props.code, tradingDate)
  })

  onMount(() => {
    const timer = window.setInterval(() => {
      if (!date()) void load(props.code, '')
    }, REFRESH_MS)
    onCleanup(() => window.clearInterval(timer))
  })

  const previousTradingDate = (): string => {
    const value = new Date()
    value.setDate(value.getDate() - 1)
    while (value.getDay() === 0 || value.getDay() === 6) value.setDate(value.getDate() - 1)
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(
      value.getDate()
    ).padStart(2, '0')}`
  }

  return (
    <div class="auction">
      <div class="auction__meta">
        <span>{loading() ? '刷新中…' : `${rows().length} 点`}</span>
        <span>{date() || '每 3 秒'}</span>
      </div>

      <div class="auction__toolbar">
        <input
          class="auction__date"
          type="date"
          value={date()}
          aria-label="竞价日期"
          onChange={(event) => setDate(event.currentTarget.value)}
        />
        <Show
          when={date()}
          fallback={
            <button class="auction__today" onClick={() => setDate(previousTradingDate())}>
              历史
            </button>
          }
        >
          <button class="auction__today" onClick={() => setDate('')}>
            回今天
          </button>
        </Show>
      </div>

      <Show when={error()}>
        {(message) => (
          <div class="auction__error" role="alert">
            {message()}
            <button class="auction__retry" onClick={() => void load(props.code)}>
              重试
            </button>
          </div>
        )}
      </Show>

      <div class="auction__head">
        <span>时间</span>
        <span class="auction__num">价格</span>
        <span class="auction__num">匹配</span>
        <span class="auction__num">未匹配</span>
      </div>

      <div class="auction__rows">
        <For each={rows()}>
          {(point) => (
            <div class="auction__row" title={`${point.time} · 虚拟撮合快照`}>
              <span class="auction__time num">{point.time}</span>
              <span class="auction__num">{fixed(point.price)}</span>
              <span class="auction__num">{thousands(point.matchedVolume)}</span>
              <span
                class="auction__num"
                classList={{
                  'tone-up': point.unmatchedDirection > 0,
                  'tone-down': point.unmatchedDirection < 0
                }}
              >
                {thousands(point.unmatchedVolume)}
              </span>
            </div>
          )}
        </For>
      </div>

      <Show when={!loading() && rows().length === 0 && !error()}>
        <div class="auction__empty">
          {date()
            ? '该日期没有竞价过程：通达信 0x056a 只保留最近交易日，更早日期通常为空'
            : '暂无竞价数据'}
        </div>
      </Show>

      <div class="auction__foot">09:15–09:25 · 虚拟匹配量，不是成交</div>
    </div>
  )
}
