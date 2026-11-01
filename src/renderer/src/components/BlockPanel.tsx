/**
 * 板块/概念浏览器（0x06b9 的 block_*.dat）。
 *
 * 左栏是板块名，右栏是成分股；成分股行情用批量快照补齐，点击行切到主行情。
 */
import { createEffect, createMemo, createSignal, For, Show, type JSX } from 'solid-js'
import type { BlockGroup, Quote } from '@shared/types'
import { compactAmount, fixed, signedPct, thousands } from '@shared/format'
import {
  BOARD_CATEGORIES,
  loadBoardCategory,
  type BoardCategory
} from '../lib/board-categories'
import { api, errorMessage } from '../lib/ipc'
import { openStockMenu } from '../stores/stockMenu'
import { createSparklineLoader, sparklineOf } from '../stores/sparklines'
import { IconClose } from './Icons'
import { Sparkline } from './Sparkline'
import { EXTRA_COLUMNS, ExtraColumnCells, ExtraColumnHeaders } from './StockExtraColumns'

interface BlockPanelProps {
  onClose: () => void
  onSelect: (quote: Quote) => void
}

type BlockTabKind = BoardCategory

const QUOTE_LIMIT = 400
const QUOTE_CHUNK = 80

export function BlockPanel(props: BlockPanelProps): JSX.Element {
  const [kind, setKind] = createSignal<BlockTabKind>('industry')
  const [blocks, setBlocks] = createSignal<BlockGroup[]>([])
  const [selected, setSelected] = createSignal<BlockGroup | null>(null)
  const [quotes, setQuotes] = createSignal<Quote[]>([])
  const [indexQuote, setIndexQuote] = createSignal<Quote | null>(null)
  const [filter, setFilter] = createSignal('')
  const [loading, setLoading] = createSignal(true)
  const [loadingQuotes, setLoadingQuotes] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  let requestId = 0
  let quoteId = 0

  const filtered = createMemo(() => {
    const query = filter().trim().toLowerCase()
    const all = blocks()
    if (!query) return all
    return all.filter((block) => block.name.toLowerCase().includes(query))
  })

  const quoteMap = createMemo(() => new Map(quotes().map((quote) => [quote.code, quote])))
  /**
   * 走势图必须等成分股报价先拉完：sidecar 是单连接，
   * 一上来就排几百个分时请求会把快照请求压到后面（界面长时间全是「—」）。
   */
  const [sparkReady, setSparkReady] = createSignal(false)
  createSparklineLoader(() =>
    sparkReady() ? (selected()?.codes ?? []).slice(0, 30) : []
  )

  const selectBlock = async (block: BlockGroup): Promise<void> => {
    setSelected(block)
    setQuotes([])
    setSparkReady(false)
    setIndexQuote(null)
    const current = ++quoteId
    setLoadingQuotes(true)
    try {
      if (block.indexCode) {
        const [index] = await api.quote.macQuotes([block.indexCode])
        if (current !== quoteId) return
        setIndexQuote(index ?? null)
      }
      const codes = block.codes.slice(0, QUOTE_LIMIT)
      const result: Quote[] = []
      for (let start = 0; start < codes.length; start += QUOTE_CHUNK) {
        const chunk = codes.slice(start, start + QUOTE_CHUNK)
        result.push(...(await api.quote.macQuotesFinance(chunk)))
        if (current !== quoteId) return
      }
      setQuotes(result)
      setSparkReady(true)
    } catch (cause) {
      if (current === quoteId) setError(errorMessage(cause))
    } finally {
      if (current === quoteId) setLoadingQuotes(false)
    }
  }

  const load = async (nextKind: BlockTabKind): Promise<void> => {
    const current = ++requestId
    setLoading(true)
    setError(null)
    setSelected(null)
    setQuotes([])
    setIndexQuote(null)
    try {
      const data = await loadBoardCategory(nextKind)
      if (current !== requestId) return
      setBlocks(data)
      const first = data[0]
      if (first) void selectBlock(first)
    } catch (cause) {
      if (current !== requestId) return
      setError(errorMessage(cause))
    } finally {
      if (current === requestId) setLoading(false)
    }
  }

  createEffect(() => {
    const currentKind = kind()
    void load(currentKind)
  })

  return (
    <div class="block-backdrop" onClick={() => props.onClose()}>
      <section
        class="block-panel"
        role="dialog"
        aria-modal="true"
        aria-label="板块与概念"
        onClick={(event) => event.stopPropagation()}
      >
        <header class="block__head">
          <div>
            <div class="block__eyebrow">
              {kind() === 'industry' ? 'tdxhy.cfg + incon.dat' : '0x06b9 · block_*.dat'}
            </div>
            <h2 class="block__title">板块 / 概念</h2>
          </div>
          <button class="btn btn--icon btn--bare" title="关闭板块" onClick={() => props.onClose()}>
            <IconClose size={16} />
          </button>
        </header>

        <div class="block__tabs" role="tablist" aria-label="板块类型">
          <For each={BOARD_CATEGORIES}>
            {(tab) => (
              <button
                class="block__tab"
                classList={{ 'block__tab--active': kind() === tab.key }}
                role="tab"
                aria-selected={kind() === tab.key}
                onClick={() => setKind(tab.key)}
              >
                {tab.label}
              </button>
            )}
          </For>
          <span class="block__count">
            <Show when={loading()} fallback={`${blocks().length} 个板块 · ${quotes().length} 只行情`}>
              下载解析中…
            </Show>
          </span>
        </div>

        <Show when={error()}>
          {(message) => (
            <div class="block__error" role="alert">
              {message()}
              <button class="block__retry" onClick={() => void load(kind())}>
                重试
              </button>
            </div>
          )}
        </Show>

        <div class="block__body">
          <aside class="block__side">
            <input
              class="block__filter"
              type="search"
              placeholder="筛选板块名称"
              value={filter()}
              onInput={(event) => setFilter(event.currentTarget.value)}
            />
            <div class="block__list">
              <Show when={!loading() && filtered().length === 0}>
                <div class="block__empty">没有匹配的板块</div>
              </Show>
              <For each={filtered()}>
                {(block) => (
                  <button
                    class="block__item"
                    classList={{ 'block__item--active': selected()?.id === block.id }}
                    title={`${block.name} · ${block.count} 只`}
                    onClick={() => void selectBlock(block)}
                  >
                    <span class="block__name">{block.name || '（未命名）'}</span>
                    <span class="block__item-count num">{block.count}</span>
                  </button>
                )}
              </For>
            </div>
          </aside>

          <section class="block__members">
            <Show
              when={selected()}
              fallback={<div class="block__empty">选择左侧板块查看成分股</div>}
            >
              {(block) => (
                <>
                  <header class="block__members-head">
                    <div class="block__members-title">
                      <strong>{block().name}</strong>
                      <Show when={indexQuote()}>
                        {(index) => (
                          <button
                            class="block__index"
                            title="查看板块指数 K 线"
                            onClick={() => props.onSelect(index())}
                          >
                            指数 {fixed(index().price)}{' '}
                            <span
                              classList={{
                                'tone-up': index().changePct > 0,
                                'tone-down': index().changePct < 0
                              }}
                            >
                              {signedPct(index().changePct)}
                            </span>
                          </button>
                        )}
                      </Show>
                    </div>
                    <span>
                      {block().codes.length} 只
                      <Show when={block().count > block().codes.length}>
                        {' '}
                        / 文件记录 {block().count}
                      </Show>
                    </span>
                  </header>
                  <Show when={loadingQuotes()}>
                    <div class="block__loading">拉取成分股行情…</div>
                  </Show>
                  <div class="block__table-wrap">
                    <table class="block__table">
                      <colgroup>
                        <col style="width: 68px" />
                        <col style="width: 130px" />
                        <col style="width: 66px" />
                        <col style="width: 68px" />
                        <col style="width: 78px" />
                        <col style="width: 56px" />
                        <col style="width: 48px" />
                        <col style="width: 54px" />
                        <For each={EXTRA_COLUMNS}>
                          {(column) => (
                            <col
                              style={{
                                width: `${
                                  column.key === 'totalCap'
                                    ? 70
                                    : column.key === 'floatCap'
                                      ? 72
                                      : column.key === 'volume'
                                        ? 70
                                        : column.width - 2
                                }px`
                              }}
                            />
                          )}
                        </For>
                        <col style="width: 36px" />
                      </colgroup>
                      <thead>
                        <tr>
                          <th>代码</th>
                          <th>名称</th>
                          <th class="num">现价</th>
                          <th class="num">涨幅</th>
                          <th class="num">成交额</th>
                          <th class="num">换手</th>
                          <th class="num">量比</th>
                          <th class="num">涨速</th>
                          <ExtraColumnHeaders />
                          <th class="num block__spark-head">走势</th>
                        </tr>
                      </thead>
                      <tbody>
                        <For each={block().codes.slice(0, QUOTE_LIMIT)}>
                          {(code) => {
                            const quote = () => quoteMap().get(code)
                            return (
                              <tr
                                class="block__row"
                                classList={{ 'block__row--noquote': !quote() }}
                                onClick={() => {
                                  const item = quote()
                                  if (item) props.onSelect(item)
                                }}
                                onContextMenu={(event) =>
                                  openStockMenu(event, {
                                    code,
                                    name: quote()?.name ?? block().names[code] ?? code
                                  })
                                }
                              >
                                <td class="block__code-cell">{code.toUpperCase()}</td>
                                <td>{quote()?.name ?? block().names[code] ?? code}</td>
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
                                <td class="num">
                                  {quote() ? compactAmount(quote()!.amount) : '—'}
                                </td>
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
                                <td class="num block__spark-cell">
                                  <Show
                                    when={sparklineOf(code)}
                                    fallback={<span class="block__spark-empty">—</span>}
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
                  </div>
                </>
              )}
            </Show>
          </section>
        </div>

        <footer class="block__foot">
          <span>
            {BOARD_CATEGORIES.find((item) => item.key === kind())?.label ?? '板块'} ·{' '}
            {blocks().length} 个板块 · {thousands(blocks().reduce((sum, b) => sum + b.codes.length, 0))}{' '}
            个代码
          </span>
          <span>点击成分股查看行情；行情最多 400 只；板块指数/K线暂未接</span>
        </footer>
      </section>
    </div>
  )
}
