/**
 * 资金流（0x0ffc）：最近 5 个交易日的主力/主买净额。
 *
 * 服务端固定返回 5 天，不能翻页；盘口右侧栏「资金流」页签使用。
 */
import { createEffect, createSignal, For, onCleanup, onMount, Show, type JSX } from 'solid-js'
import type { MacMoneyFlow, MoneyFlowRecord } from '@shared/types'
import { compactAmount, signedPct } from '@shared/format'
import { api, errorMessage } from '../lib/ipc'

interface MoneyFlowProps {
  code: string
}

const REFRESH_MS = 60_000

export function MoneyFlow(props: MoneyFlowProps): JSX.Element {
  const [rows, setRows] = createSignal<MoneyFlowRecord[]>([])
  const [loading, setLoading] = createSignal(true)
  const [error, setError] = createSignal<string | null>(null)
  const [mac, setMac] = createSignal<MacMoneyFlow | null>(null)
  let requestId = 0

  const load = async (code: string): Promise<void> => {
    const current = ++requestId
    setLoading(true)
    try {
      const [data, macData] = await Promise.all([
        api.money.flow(code),
        api.money.macFlow(code).catch(() => null)
      ])
      if (current !== requestId) return
      setRows(data)
      setMac(macData)
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

  return (
    <div class="flow">
      <div class="flow__meta">
        <span>{loading() ? '刷新中…' : `${rows().length} 个交易日`}</span>
        <span>每 60 秒</span>
      </div>

      <Show when={error()}>
        {(message) => (
          <div class="flow__error" role="alert">
            {message()}
            <button class="flow__retry" onClick={() => void load(props.code)}>
              重试
            </button>
          </div>
        )}
      </Show>

      <div class="flow__head">
        <span>日期</span>
        <span class="flow__num">主力净额</span>
        <span class="flow__num">占比</span>
        <span class="flow__num">主买净额</span>
      </div>

      <div class="flow__rows">
        <For each={rows()}>
          {(row) => (
            <div
              class="flow__row"
              classList={{
                'flow__row--positive': row.mainNet > 0,
                'flow__row--negative': row.mainNet < 0
              }}
              title={`${row.date} · 成交额 ${compactAmount(row.totalAmount)}`}
            >
              <span class="flow__date num">{row.date.slice(5)}</span>
              <span class="flow__num">{compactAmount(row.mainNet)}</span>
              <span class="flow__num">{signedPct(row.mainRatio)}</span>
              <span class="flow__num">{compactAmount(row.mainBuyNet)}</span>
            </div>
          )}
        </For>
      </div>

      <Show when={!loading() && rows().length === 0 && !error()}>
        <div class="flow__empty">暂无资金流</div>
      </Show>

      <div class="flow__foot">
        <span>0x0ffc · 主力 = 超大 + 大单</span>
      </div>

      <Show when={mac()}>
        {(data) => (
          <div class="flow__mac">
            <div class="flow__mac-title">MAC 0x1218 · 今日 / 5 日</div>
            <div class="flow__mac-grid">
              <span>主力净额</span>
              <b class={data().mainNet >= 0 ? 'tone-up' : 'tone-down'}>
                {compactAmount(data().mainNet)}
              </b>
              <span>散户净额</span>
              <b class={data().retailNet >= 0 ? 'tone-up' : 'tone-down'}>
                {compactAmount(data().retailNet)}
              </b>
              <span>5 日大单</span>
              <b class={data().largeNet5d >= 0 ? 'tone-up' : 'tone-down'}>
                {compactAmount(data().largeNet5d)}
              </b>
              <span>5 日中单</span>
              <b class={data().midNet5d >= 0 ? 'tone-up' : 'tone-down'}>
                {compactAmount(data().midNet5d)}
              </b>
            </div>
          </div>
        )}
      </Show>
    </div>
  )
}
