/**
 * 排行榜（0x054b）。
 *
 * 服务端排序的一页 A 股行情，切换 tab 只改 `sortType`，不在前端重排。
 * 点击某一行把该股行情塞进 quote store 再切过去，不强行加入自选。
 */
import { createEffect, createSignal, For, onCleanup, onMount, Show, type JSX } from 'solid-js'
import type { CategoryQuote } from '@shared/types'
import { compactAmount, fixed, signedPct } from '@shared/format'
import { api, errorMessage } from '../lib/ipc'
import { IconClose } from './Icons'

interface RankingPanelProps {
  onClose: () => void
  onSelect: (quote: CategoryQuote) => void
}

interface SortTab {
  label: string
  sortType: number
  metric: (quote: CategoryQuote) => number
}

const SORTS: SortTab[] = [
  { label: '涨幅', sortType: 0x000e, metric: (quote) => quote.changePct },
  { label: '成交额', sortType: 0x000a, metric: (quote) => quote.amount },
  { label: '涨速', sortType: 0x002e, metric: (quote) => quote.riseSpeed ?? 0 },
  { label: '短换手', sortType: 0x00cc, metric: (quote) => quote.shortTurnover ?? 0 },
  { label: '封单额', sortType: 0x001c, metric: (quote) => quote.lockedAmount ?? 0 }
]

export function RankingPanel(props: RankingPanelProps): JSX.Element {
  const [sort, setSort] = createSignal(SORTS[0])
  const [rows, setRows] = createSignal<CategoryQuote[]>([])
  const [loading, setLoading] = createSignal(true)
  const [loadingMore, setLoadingMore] = createSignal(false)
  const [expanded, setExpanded] = createSignal(false)
  const [hasMore, setHasMore] = createSignal(true)
  const [error, setError] = createSignal<string | null>(null)
  let requestId = 0

  const load = async (): Promise<void> => {
    const current = ++requestId
    setLoading(true)
    try {
      const data = await api.quote.category({
        category: 6,
        sortType: sort().sortType,
        count: 80
      })
      if (current !== requestId) return
      setRows(data)
      setHasMore(data.length === 80)
      setError(null)
    } catch (cause) {
      if (current !== requestId) return
      setError(errorMessage(cause))
    } finally {
      if (current === requestId) setLoading(false)
    }
  }

  const loadMore = async (): Promise<void> => {
    if (!hasMore() || loadingMore()) return
    const current = ++requestId
    setLoadingMore(true)
    setExpanded(true)
    try {
      const data = await api.quote.category({
        category: 6,
        sortType: sort().sortType,
        start: rows().length,
        count: 80
      })
      if (current !== requestId) return
      setRows([...rows(), ...data])
      setHasMore(data.length === 80)
      setError(null)
    } catch (cause) {
      if (current !== requestId) return
      setExpanded(false)
      setError(errorMessage(cause))
    } finally {
      if (current === requestId) setLoadingMore(false)
    }
  }

  // sort() 变化 → 重新向服务端要第一页；首次挂载也会走这里
  createEffect(() => {
    sort()
    setExpanded(false)
    void load()
  })

  onMount(() => {
    const timer = window.setInterval(() => {
      if (!expanded()) void load()
    }, 10_000)
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') props.onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    onCleanup(() => {
      window.clearInterval(timer)
      window.removeEventListener('keydown', onKeyDown)
    })
  })

  return (
    <div class="ranking-backdrop" onClick={() => props.onClose()}>
      <section
        class="ranking"
        role="dialog"
        aria-modal="true"
        aria-label="A 股排行榜"
        onClick={(event) => event.stopPropagation()}
      >
        <header class="ranking__head">
          <div>
            <div class="ranking__eyebrow">沪深 A 股 · 服务端排序</div>
            <h2 class="ranking__title">排行榜</h2>
          </div>
          <button
            class="btn btn--icon btn--bare"
            title="关闭排行榜"
            onClick={() => props.onClose()}
          >
            <IconClose size={16} />
          </button>
        </header>

        <div class="ranking__tabs" role="tablist" aria-label="排序方式">
          <For each={SORTS}>
            {(item) => (
              <button
                class="ranking__tab"
                classList={{ 'ranking__tab--active': item.sortType === sort().sortType }}
                role="tab"
                aria-selected={item.sortType === sort().sortType}
                onClick={() => setSort(item)}
              >
                {item.label}
              </button>
            )}
          </For>
          <span class="ranking__count">
            <Show when={loading()} fallback={`${rows().length} 只`}>
              刷新中…
            </Show>
          </span>
        </div>

        <Show when={error()}>
          {(message) => (
            <div class="ranking__error" role="alert">
              {message()}
              <button class="ranking__retry" onClick={() => void load()}>
                重试
              </button>
            </div>
          )}
        </Show>

        <div class="ranking__table-wrap">
          <table class="ranking__table">
            <thead>
              <tr>
                <th class="ranking__rank">#</th>
                <th>代码 / 名称</th>
                <th class="ranking__num">现价</th>
                <th class="ranking__num">涨幅</th>
                <th class="ranking__num">成交额</th>
                <th class="ranking__num">{sort().label}</th>
              </tr>
            </thead>
            <tbody>
              <For each={rows()}>
                {(quote, index) => (
                  <tr class="ranking__row" onClick={() => props.onSelect(quote)}>
                    <td class="ranking__rank num">{index() + 1}</td>
                    <td>
                      <div class="ranking__name">{quote.name}</div>
                      <div class="ranking__code num">{quote.code.toUpperCase()}</div>
                    </td>
                    <td class="ranking__num num">{fixed(quote.price)}</td>
                    <td
                      class="ranking__num num"
                      classList={{
                        'tone-up': quote.changePct > 0,
                        'tone-down': quote.changePct < 0
                      }}
                    >
                      {signedPct(quote.changePct)}
                    </td>
                    <td class="ranking__num num">{compactAmount(quote.amount)}</td>
                    <td class="ranking__num num">{metricText(quote, sort())}</td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
          <Show when={!loading() && rows().length === 0 && !error()}>
            <div class="ranking__empty">这一页没有数据</div>
          </Show>
        </div>

        <footer class="ranking__foot">
          <span>数据源：通达信 7709 · 0x054b</span>
          <Show when={hasMore()} fallback={<span>已到末尾</span>}>
            <button class="ranking__more" disabled={loadingMore()} onClick={() => void loadMore()}>
              {loadingMore() ? '加载中…' : '加载更多'}
            </button>
          </Show>
        </footer>
      </section>
    </div>
  )
}

function metricText(quote: CategoryQuote, tab: SortTab): string {
  const value = tab.metric(quote)
  if (tab.sortType === 0x000a || tab.sortType === 0x001c) return compactAmount(value)
  if (tab.sortType === 0x000e) return signedPct(value)
  return `${fixed(value)}%`
}
