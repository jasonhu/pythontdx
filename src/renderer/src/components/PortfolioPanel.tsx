/**
 * 组合分析：当前自选分组的当日快照 + 本地持仓盈亏。
 *
 * 等权平均只是当日的横截面统计，不等于组合真实收益；真实盈亏看持仓表。
 */
import { createMemo, createSignal, For, Show, type JSX } from 'solid-js'
import type { PortfolioPosition, Quote } from '@shared/types'
import { compactAmount, fixed, signedPct } from '@shared/format'
import { computePortfolio } from '@shared/portfolio'
import { activeItems, appState, savePositions } from '../stores/app'
import { quoteOf } from '../stores/quotes'
import { IconClose } from './Icons'

interface Draft {
  shares: string
  cost: string
}

export function PortfolioPanel(props: {
  onClose: () => void
  onSelect: (quote: Quote) => void
}): JSX.Element {
  const rows = createMemo(() =>
    activeItems()
      .map((item) => quoteOf(item.code))
      .filter((quote): quote is Quote => quote !== undefined)
  )

  const [editing, setEditing] = createSignal(false)
  const [draft, setDraft] = createSignal<Record<string, Draft>>({})

  const draftFor = (code: string): Draft => {
    const saved = appState.positions?.find((position) => position.code === code)
    return (
      draft()[code] ?? {
        shares: saved && saved.shares > 0 ? String(saved.shares) : '',
        cost: saved && saved.cost > 0 ? String(saved.cost) : ''
      }
    )
  }

  const setDraftValue = (code: string, key: keyof Draft, value: string): void => {
    setDraft((current) => ({ ...current, [code]: { ...draftFor(code), [key]: value } }))
  }

  const draftPositions = createMemo<PortfolioPosition[]>(() =>
    rows()
      .map((quote) => draftFor(quote.code))
      .map((value, index) => ({
        code: rows()[index].code,
        shares: Number(value.shares) || 0,
        cost: Number(value.cost) || 0
      }))
      .filter((position) => position.shares > 0 && position.cost > 0)
  )

  const summary = createMemo(() => computePortfolio(rows(), draftPositions()))

  const stats = createMemo(() => {
    const list = rows()
    const valid = list.filter((quote) => Number.isFinite(quote.changePct))
    return {
      count: list.length,
      up: valid.filter((quote) => quote.changePct > 0).length,
      down: valid.filter((quote) => quote.changePct < 0).length,
      flat: valid.filter((quote) => quote.changePct === 0).length,
      average:
        valid.length > 0
          ? valid.reduce((sum, quote) => sum + quote.changePct, 0) / valid.length
          : 0,
      amount: list.reduce((sum, quote) => sum + (quote.amount ?? 0), 0)
    }
  })

  const startEditing = (): void => {
    const positions = appState.positions ?? []
    const next: Record<string, Draft> = {}
    for (const quote of rows()) {
      const saved = positions.find((position) => position.code === quote.code)
      next[quote.code] = {
        shares: saved?.shares ? String(saved.shares) : '',
        cost: saved?.cost ? String(saved.cost) : ''
      }
    }
    setDraft(next)
    setEditing(true)
  }

  const save = (): void => {
    savePositions(draftPositions())
    setEditing(false)
    setDraft({})
  }

  return (
    <div class="portfolio-backdrop" onClick={() => props.onClose()}>
      <section
        class="portfolio-panel"
        role="dialog"
        aria-modal="true"
        aria-label="组合分析"
        onClick={(event) => event.stopPropagation()}
      >
        <header class="portfolio__head">
          <div>
            <div class="portfolio__eyebrow">当前自选分组 · 当日快照</div>
            <h2 class="portfolio__title">组合分析</h2>
          </div>
          <div class="portfolio__head-actions">
            <Show
              when={editing()}
              fallback={
                <button class="btn portfolio-edit" onClick={startEditing}>
                  编辑持仓
                </button>
              }
            >
              <button class="btn portfolio-save" onClick={save}>
                保存持仓
              </button>
            </Show>
            <button
              class="btn btn--icon btn--bare"
              title="关闭组合分析"
              onClick={() => props.onClose()}
            >
              <IconClose size={16} />
            </button>
          </div>
        </header>

        <div class="portfolio__stats">
          <div>
            <span>等权平均</span>
            <strong
              classList={{
                'tone-up': stats().average > 0,
                'tone-down': stats().average < 0
              }}
            >
              {signedPct(stats().average)}
            </strong>
          </div>
          <div>
            <span>上涨 / 下跌 / 平</span>
            <strong>
              {stats().up} / {stats().down} / {stats().flat}
            </strong>
          </div>
          <div>
            <span>持仓市值</span>
            <strong>{compactAmount(summary().totalValue)}</strong>
          </div>
          <div>
            <span>浮动盈亏</span>
            <strong
              classList={{
                'tone-up': summary().pnl > 0,
                'tone-down': summary().pnl < 0
              }}
            >
              {compactAmount(summary().pnl)}
              <small> {signedPct(summary().pnlPct)}</small>
            </strong>
          </div>
        </div>

        <div class="portfolio__table-wrap">
          <table class="portfolio-table">
            <thead>
              <tr>
                <th>名称</th>
                <th>代码</th>
                <th>现价</th>
                <th>涨跌幅</th>
                <Show when={editing()}>
                  <th>持股</th>
                  <th>成本</th>
                </Show>
                <th>市值</th>
                <th>盈亏</th>
                <th>权重</th>
              </tr>
            </thead>
            <tbody>
              <For each={rows()}>
                {(quote) => {
                  const position = createMemo(() =>
                    summary().rows.find((row) => row.code === quote.code)
                  )
                  return (
                    <tr
                      onClick={() => {
                        if (!editing()) {
                          props.onSelect(quote)
                          props.onClose()
                        }
                      }}
                    >
                      <td>{quote.name}</td>
                      <td class="num">{quote.code.toUpperCase()}</td>
                      <td class="num">{fixed(quote.price)}</td>
                      <td
                        class="num"
                        classList={{
                          'tone-up': quote.changePct > 0,
                          'tone-down': quote.changePct < 0
                        }}
                      >
                        {signedPct(quote.changePct)}
                      </td>
                      <Show when={editing()}>
                        <td>
                          <input
                            class="portfolio-input portfolio-shares"
                            type="number"
                            min="0"
                            step="100"
                            value={draftFor(quote.code).shares}
                            onClick={(event) => event.stopPropagation()}
                            onInput={(event) =>
                              setDraftValue(quote.code, 'shares', event.currentTarget.value)
                            }
                          />
                        </td>
                        <td>
                          <input
                            class="portfolio-input portfolio-cost"
                            type="number"
                            min="0"
                            step="0.01"
                            value={draftFor(quote.code).cost}
                            onClick={(event) => event.stopPropagation()}
                            onInput={(event) =>
                              setDraftValue(quote.code, 'cost', event.currentTarget.value)
                            }
                          />
                        </td>
                      </Show>
                      <td class="num">
                        {position() ? compactAmount(position()!.marketValue) : '—'}
                      </td>
                      <td
                        class="num"
                        classList={{
                          'tone-up': (position()?.pnl ?? 0) > 0,
                          'tone-down': (position()?.pnl ?? 0) < 0
                        }}
                      >
                        {position() ? compactAmount(position()!.pnl) : '—'}
                      </td>
                      <td class="num">{position() ? `${fixed(position()!.weight)}%` : '—'}</td>
                    </tr>
                  )
                }}
              </For>
            </tbody>
          </table>
          <div class="portfolio__empty">
            {rows().length === 0
              ? '当前分组还没有行情，等待刷新…'
              : editing()
                ? '填持股数与成本后保存；空行视为未持仓'
                : '点击行切换主行情；持仓成本只存在本机'}
          </div>
        </div>
      </section>
    </div>
  )
}
