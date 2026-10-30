/**
 * 全市场列表：A 股 / 指数 / 科创板 / 创业板 / 北证。
 *
 * 代码与名称来自代码表；当前页报价通过 0x054c 批量快照补齐。
 * 不按 0x054b 的“分类”猜测市场——分类编号在不同主站上并不稳定。
 */
import { createEffect, createMemo, createSignal, For, Show, type JSX } from 'solid-js'
import type { Quote } from '@shared/types'
import type { SearchSecurity } from '@shared/search'
import { compactAmount, fixed, signedPct } from '@shared/format'
import { api, errorMessage } from '../lib/ipc'
import { IconClose } from './Icons'

type TabKey = 'all' | 'index' | 'fund' | 'reit' | 'bond' | 'kcb' | 'cyb' | 'bj' | 'b'

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'all', label: '全部 A 股' },
  { key: 'index', label: '指数' },
  { key: 'fund', label: '基金' },
  { key: 'reit', label: 'REITs' },
  { key: 'bond', label: '债券' },
  { key: 'kcb', label: '科创板' },
  { key: 'cyb', label: '创业板' },
  { key: 'bj', label: '北证' },
  { key: 'b', label: 'B股' }
]

const PAGE_SIZE = 100

function isAShare(item: SearchSecurity): boolean {
  const symbol = item.symbol
  if (item.kind !== 'GP-A') return false
  if (item.market === 'SH') return /^(600|601|603|605|688|689)/.test(symbol)
  if (item.market === 'SZ') return /^(000|001|002|003|300|301|302)/.test(symbol)
  if (item.market === 'BJ') return /^[489]/.test(symbol)
  return false
}

function matches(tab: TabKey, item: SearchSecurity): boolean {
  const symbol = item.symbol
  if (tab === 'index') return item.kind === 'ZS'
  if (tab === 'fund') return item.kind === 'JJ'
  if (tab === 'reit') return item.kind === 'JJ' && /^(508|180)/.test(symbol)
  if (tab === 'bond') return item.kind === 'ZQ'
  if (tab === 'b') return item.kind === 'GP-B'
  if (!isAShare(item)) return false
  if (tab === 'kcb') return symbol.startsWith('688') || symbol.startsWith('689')
  if (tab === 'cyb')
    return symbol.startsWith('300') || symbol.startsWith('301') || symbol.startsWith('302')
  if (tab === 'bj') return item.market === 'BJ'
  return true
}

export function MarketListPanel(props: {
  onClose: () => void
  onSelect: (quote: Quote) => void
  onOpenBlocks: () => void
}): JSX.Element {
  const [catalog, setCatalog] = createSignal<SearchSecurity[]>([])
  const [tab, setTab] = createSignal<TabKey>('all')
  const [query, setQuery] = createSignal('')
  const [page, setPage] = createSignal(0)
  const [quotes, setQuotes] = createSignal<Quote[]>([])
  const [loading, setLoading] = createSignal(true)
  const [error, setError] = createSignal<string | null>(null)
  let requestId = 0

  createEffect(() => {
    void (async () => {
      try {
        const data = await api.quote.catalog()
        setCatalog(data)
      } catch (cause) {
        setError(errorMessage(cause))
      } finally {
        setLoading(false)
      }
    })()
  })

  const filtered = createMemo(() => {
    const text = query().trim().toLowerCase()
    return catalog()
      .filter((item) => matches(tab(), item))
      .filter(
        (item) =>
          !text || item.code.toLowerCase().includes(text) || item.name.toLowerCase().includes(text)
      )
  })

  const pageCount = createMemo(() => Math.max(1, Math.ceil(filtered().length / PAGE_SIZE)))
  const pageItems = createMemo(() =>
    filtered().slice(page() * PAGE_SIZE, page() * PAGE_SIZE + PAGE_SIZE)
  )

  createEffect(() => {
    page()
    tab()
    query()
    const current = ++requestId
    const codes = pageItems().map((item) => item.code)
    setQuotes([])
    if (codes.length === 0) {
      setLoading(false)
      return
    }
    setLoading(true)
    void (async () => {
      try {
        const data = await api.quote.snapshot(codes)
        if (current !== requestId) return
        setQuotes(data)
        setError(null)
      } catch (cause) {
        if (current === requestId) setError(errorMessage(cause))
      } finally {
        if (current === requestId) setLoading(false)
      }
    })()
  })

  const quoteMap = createMemo(() => new Map(quotes().map((quote) => [quote.code, quote])))

  return (
    <div class="market-backdrop" onClick={() => props.onClose()}>
      <section
        class="market-panel"
        role="dialog"
        aria-modal="true"
        aria-label="全市场列表"
        onClick={(event) => event.stopPropagation()}
      >
        <header class="market__head">
          <div>
            <div class="market__eyebrow">代码表 + 0x054c 批量快照</div>
            <h2 class="market__title">市场列表</h2>
          </div>
          <button
            class="btn btn--icon btn--bare"
            title="关闭市场列表"
            onClick={() => props.onClose()}
          >
            <IconClose size={16} />
          </button>
        </header>

        <div class="market__tabs" role="tablist">
          <For each={TABS}>
            {(item) => (
              <button
                class={`market__tab market__tab--${item.key}`}
                data-active={tab() === item.key}
                onClick={() => {
                  setTab(item.key)
                  setPage(0)
                }}
              >
                {item.label}
              </button>
            )}
          </For>
          <input
            class="market__search"
            type="search"
            placeholder="搜索代码 / 名称"
            value={query()}
            onInput={(event) => {
              setQuery(event.currentTarget.value)
              setPage(0)
            }}
          />
        </div>

        <Show when={error()}>{(message) => <div class="market__error">{message()}</div>}</Show>

        <div class="market__table-wrap">
          <table class="market__table">
            <thead>
              <tr>
                <th>代码</th>
                <th>名称</th>
                <th>市场</th>
                <th>类型</th>
                <th class="num">现价</th>
                <th class="num">涨跌幅</th>
                <th class="num">成交额</th>
              </tr>
            </thead>
            <tbody>
              <For each={pageItems()}>
                {(item) => {
                  const quote = () => quoteMap().get(item.code)
                  return (
                    <tr
                      onClick={() => {
                        const current = quote()
                        if (current) {
                          props.onSelect(current)
                          props.onClose()
                        }
                      }}
                    >
                      <td class="num">{item.code.toUpperCase()}</td>
                      <td>{quote()?.name || item.name}</td>
                      <td>{item.market}</td>
                      <td class="market__kind">{item.kind}</td>
                      <td class="num">{quote() ? fixed(quote()!.price) : '—'}</td>
                      <td
                        class="num"
                        classList={{
                          'tone-up': (quote()?.changePct ?? 0) > 0,
                          'tone-down': (quote()?.changePct ?? 0) < 0
                        }}
                      >
                        {quote() ? signedPct(quote()!.changePct) : '—'}
                      </td>
                      <td class="num">{quote() ? compactAmount(quote()!.amount) : '—'}</td>
                    </tr>
                  )
                }}
              </For>
            </tbody>
          </table>
          <Show when={loading()}>
            <div class="market__loading">加载当前页报价…</div>
          </Show>
          <Show when={!loading() && pageItems().length === 0}>
            <div class="market__empty">没有匹配的证券</div>
          </Show>
        </div>

        <footer class="market__foot">
          <span>
            共 {filtered().length} 条 · 第 {page() + 1} / {pageCount()} 页
          </span>
          <button
            class="btn market__blocks"
            onClick={() => {
              props.onClose()
              props.onOpenBlocks()
            }}
          >
            板块个股
          </button>
          <div class="market__pager">
            <button
              class="btn market__prev"
              disabled={page() === 0}
              onClick={() => setPage((value) => Math.max(0, value - 1))}
            >
              上一页
            </button>
            <button
              class="btn market__next"
              disabled={page() + 1 >= pageCount()}
              onClick={() => setPage((value) => Math.min(pageCount() - 1, value + 1))}
            >
              下一页
            </button>
          </div>
        </footer>
      </section>
    </div>
  )
}
