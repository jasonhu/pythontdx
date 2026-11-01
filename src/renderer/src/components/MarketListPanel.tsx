/**
 * 全市场列表：A 股 / 指数 / 科创板 / 创业板 / 北证。
 *
 * 代码与名称来自代码表；当前页报价通过 0x054c 批量快照补齐。
 * 不按 0x054b 的“分类”猜测市场——分类编号在不同主站上并不稳定。
 */
import { createEffect, createMemo, createSignal, For, Show, type JSX } from 'solid-js'
import type { Quote } from '@shared/types'
import type { SearchEntry, SearchSecurity } from '@shared/search'
import { compactAmount, fixed, signedPct } from '@shared/format'
import { api, errorMessage } from '../lib/ipc'
import { openStockMenu } from '../stores/stockMenu'
import { downloadText } from '../lib/download'
import { toCsv } from '@shared/csv'
import { createSparklineLoader, sparklineOf } from '../stores/sparklines'
import { IconClose } from './Icons'
import { Sparkline } from './Sparkline'
import { EXTRA_COLUMNS, ExtraColumnCells, ExtraColumnHeaders } from './StockExtraColumns'

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

type SortMode =
  'default' | 'change' | 'changeAsc' | 'amount' | 'price' | 'turnover' | 'volume' | 'speed'

function metric(map: Map<string, Quote>, mode: SortMode, item: SearchSecurity): number {
  const quote = map.get(item.code)
  if (!quote) return Number.NEGATIVE_INFINITY
  if (mode === 'change') return quote.changePct
  if (mode === 'changeAsc') return -quote.changePct
  if (mode === 'turnover') return quote.turnoverRate ?? 0
  if (mode === 'volume') return quote.volumeRatio ?? 0
  if (mode === 'speed') return quote.riseSpeed ?? 0
  if (mode === 'amount') return quote.amount ?? 0
  return quote.price
}

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
  const [sort, setSort] = createSignal<SortMode>('default')
  const [rankedCodes, setRankedCodes] = createSignal<string[]>([])
  const [allKey, setAllKey] = createSignal('')
  const [allLoading, setAllLoading] = createSignal(false)
  const [allProgress, setAllProgress] = createSignal('')
  const [pinyinReady, setPinyinReady] = createSignal(false)
  let requestId = 0
  let allRequestId = 0
  /** 拼音索引按需构建（pinyin-pro 词典较大，动态 import 让首屏不背这份体积） */
  let searchIndex: SearchEntry[] | undefined
  let pinyinMatcher: ((entry: SearchEntry, keyword: string) => boolean) | undefined
  let pinyinLoading: Promise<void> | undefined

  const loadPinyinIndex = (): Promise<void> => {
    if (searchIndex) return Promise.resolve()
    // 在同步段读取响应式代码表：异步回调里读不会触发依赖跟踪
    const items = catalog()
    pinyinLoading ??= import('@shared/search').then((module) => {
      pinyinLoading = undefined
      if (items.length === 0) return
      pinyinMatcher = module.matchesPinyin
      searchIndex = module.buildSearchEntries(items)
      setPinyinReady(true)
    })
    return pinyinLoading
  }

  createEffect(() => {
    // 只在输入看起来像拼音时构建索引，纯数字/中文查询不付这份成本
    if (catalog().length > 0 && /^[a-z]{2,}$/i.test(query().trim())) void loadPinyinIndex()
  })

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
    // 订阅索引就绪状态：拼音索引异步建好后要让过滤重新跑一遍
    const entries = pinyinReady() ? searchIndex : undefined
    const entryOf = entries ? new Map(entries.map((entry) => [entry.info.code, entry])) : null
    const phonetic = text.replace(/[^a-z0-9\u4e00-\u9fff]/g, '')
    return catalog()
      .filter((item) => matches(tab(), item))
      .filter((item) => {
        if (!text) return true
        if (item.code.toLowerCase().includes(text) || item.name.toLowerCase().includes(text)) {
          return true
        }
        const entry = entryOf?.get(item.code)
        if (!entry || !phonetic || !pinyinMatcher) return false
        return pinyinMatcher(entry, phonetic)
      })
  })

  const sortKey = createMemo(() => `${tab()}|${query()}`)

  const displayed = createMemo(() => {
    const base = filtered()
    const mode = sort()
    const order = rankedCodes()
    if (mode === 'default' || order.length === 0) return base
    const rank = new Map(order.map((code, index) => [code, index]))
    return [...base].sort(
      (a, b) =>
        (rank.get(a.code) ?? Number.MAX_SAFE_INTEGER) -
        (rank.get(b.code) ?? Number.MAX_SAFE_INTEGER)
    )
  })

  const pageCount = createMemo(() => Math.max(1, Math.ceil(displayed().length / PAGE_SIZE)))
  const pageItems = createMemo(() =>
    displayed().slice(page() * PAGE_SIZE, page() * PAGE_SIZE + PAGE_SIZE)
  )

  const loadAll = async (mode: SortMode): Promise<void> => {
    if (mode === 'default') {
      setSort('default')
      setPage(0)
      return
    }
    const key = sortKey()
    setSort(mode)
    setPage(0)
    if (allKey() === key && rankedCodes().length > 0) return
    const current = ++allRequestId
    setAllLoading(true)
    setError(null)
    try {
      const codes = filtered().map((item) => item.code)
      await new Promise((resolve) => setTimeout(resolve, 300))
      const quotes = new Map<string, Quote>()
      // 一次 5,600 只会让 Electron IPC 响应过大；按 400 只分批，进度可见。
      for (let start = 0; start < codes.length; start += 400) {
        if (current !== allRequestId) return
        setAllProgress(`${Math.min(start + 400, codes.length)} / ${codes.length}`)
        const data = await api.quote.macQuotes(codes.slice(start, start + 400))
        for (const quote of data) quotes.set(quote.code, quote)
      }
      if (current !== allRequestId) return
      const ranked = [...codes].sort(
        (a, b) =>
          metric(quotes, mode, { code: b } as SearchSecurity) -
          metric(quotes, mode, { code: a } as SearchSecurity)
      )
      setRankedCodes(ranked)
      setAllKey(key)
      setAllProgress('')
    } catch (cause) {
      if (current === allRequestId) setError(errorMessage(cause))
    } finally {
      if (current === allRequestId) setAllLoading(false)
    }
  }

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
        // MAC 批量报价带量比/涨速；默认排序也用它，列不会出现整列「—」
        const data = await api.quote.macQuotesFinance(codes)
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
  // 当前页 100 只，排队加载分时（限并发），翻页自动换一批
  createSparklineLoader(() => pageItems().slice(0, 30).map((item) => item.code))

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
                  setSort('default')
                  setAllKey('')
                }}
              >
                {item.label}
              </button>
            )}
          </For>
          <div class="market__sorts">
            <For
              each={
                [
                  ['default', '默认'],
                  ['change', '涨幅'],
                  ['changeAsc', '跌幅'],
                  ['amount', '成交额'],
                  ['price', '现价'],
                  ['turnover', '换手'],
                  ['volume', '量比'],
                  ['speed', '涨速']
                ] as Array<[SortMode, string]>
              }
            >
              {([value, label]) => (
                <button
                  class={`market__sort market__sort--${value}`}
                  data-active={sort() === value}
                  onClick={() => void loadAll(value)}
                >
                  {label}
                </button>
              )}
            </For>
          </div>
          <input
            class="market__search"
            type="search"
            placeholder="搜索代码 / 名称 / 拼音首字母"
            value={query()}
            onInput={(event) => {
              setQuery(event.currentTarget.value)
              setPage(0)
              setSort('default')
              setAllKey('')
            }}
          />
        </div>

        <Show when={error()}>{(message) => <div class="market__error">{message()}</div>}</Show>

        <div class="market__table-wrap">
          <table class="market__table">
            <colgroup>
              <col style="width: 78px" />
              <col style="width: 130px" />
              <col style="width: 46px" />
              <col style="width: 54px" />
              <col style="width: 74px" />
              <col style="width: 76px" />
              <col style="width: 86px" />
              <col style="width: 58px" />
              <col style="width: 52px" />
              <col style="width: 60px" />
              <For each={EXTRA_COLUMNS}>
                {(column) => <col style={{ width: `${column.width}px` }} />}
              </For>
              <col style="width: 50px" />
            </colgroup>
            <thead>
              <tr>
                <th>代码</th>
                <th>名称</th>
                <th>市场</th>
                <th>类型</th>
                <th class="num">现价</th>
                <th class="num">涨跌幅</th>
                <th class="num">成交额</th>
                <th class="num">换手</th>
                <th class="num">量比</th>
                <th class="num">涨速</th>
                <ExtraColumnHeaders />
                <th class="num market__spark-head">走势</th>
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
                      onContextMenu={(event) =>
                        openStockMenu(event, {
                          code: item.code,
                          name: quote()?.name || item.name
                        })
                      }
                    >
                      <td>{item.code.toUpperCase()}</td>
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
                      <td class="num">
                        {quote()?.turnoverRate !== undefined
                          ? `${quote()!.turnoverRate!.toFixed(2)}%`
                          : '—'}
                      </td>
                      <td class="num">
                        {quote()?.volumeRatio !== undefined
                          ? quote()!.volumeRatio!.toFixed(2)
                          : '—'}
                      </td>
                      <td class="num">
                        {quote()?.riseSpeed !== undefined
                          ? `${quote()!.riseSpeed!.toFixed(2)}%`
                          : '—'}
                      </td>
                      <ExtraColumnCells quote={quote()} />
                      <td class="num market__spark-cell">
                        <Show
                          when={sparklineOf(item.code)}
                          fallback={<span class="market__spark-empty">—</span>}
                        >
                          {(data) => (
                            <Sparkline
                              values={data().values}
                              baseline={data().prevClose}
                              width={46}
                              height={20}
                            />
                          )}
                        </Show>
                      </td>
                    </tr>
                  )
                }}
              </For>
            </tbody>
          </table>
          <Show when={loading()}>
            <div class="market__loading">加载当前页报价…</div>
          </Show>
          <Show when={allLoading()}>
            <div class="market__loading">MAC 加载整栏报价并排序… {allProgress()}</div>
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
            class="btn market__export"
            onClick={() => {
              const rows = pageItems().map((item) => {
                const quote = quoteMap().get(item.code)
                return [
                  item.code,
                  item.name,
                  item.market,
                  item.kind,
                  quote?.price ?? '',
                  quote?.changePct ?? '',
                  quote?.amount ?? '',
                  quote?.turnoverRate ?? '',
                  quote?.volumeRatio ?? '',
                  quote?.riseSpeed ?? ''
                ]
              })
              downloadText(
                `stocklens-market-page-${page() + 1}.csv`,
                toCsv(
                  [
                    '代码',
                    '名称',
                    '市场',
                    '类型',
                    '现价',
                    '涨跌幅',
                    '成交额',
                    '换手率',
                    '量比',
                    '涨速'
                  ],
                  rows
                )
              )
            }}
          >
            导出本页
          </button>
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
