/**
 * 组合分析：当前自选分组的当日快照。
 *
 * 只做当日等权统计，不把“等权平均涨幅”冒充组合净值曲线。
 */
import { createMemo, For, type JSX } from 'solid-js'
import type { Quote } from '@shared/types'
import { compactAmount, fixed, signedPct, thousands } from '@shared/format'
import { activeItems } from '../stores/app'
import { quoteOf } from '../stores/quotes'
import { IconClose } from './Icons'

export function PortfolioPanel(props: {
  onClose: () => void
  onSelect: (quote: Quote) => void
}): JSX.Element {
  const rows = createMemo(() =>
    activeItems()
      .map((item) => quoteOf(item.code))
      .filter((quote): quote is Quote => quote !== undefined)
  )

  const stats = createMemo(() => {
    const list = rows()
    const valid = list.filter((quote) => Number.isFinite(quote.changePct))
    const average =
      valid.length > 0 ? valid.reduce((sum, quote) => sum + quote.changePct, 0) / valid.length : 0
    return {
      count: list.length,
      up: valid.filter((quote) => quote.changePct > 0).length,
      down: valid.filter((quote) => quote.changePct < 0).length,
      flat: valid.filter((quote) => quote.changePct === 0).length,
      average,
      amount: list.reduce((sum, quote) => sum + (quote.amount ?? 0), 0)
    }
  })

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
          <button
            class="btn btn--icon btn--bare"
            title="关闭组合分析"
            onClick={() => props.onClose()}
          >
            <IconClose size={16} />
          </button>
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
            <span>标的数</span>
            <strong>{stats().count}</strong>
          </div>
          <div>
            <span>成交额合计</span>
            <strong>{compactAmount(stats().amount)}</strong>
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
                <th>成交额</th>
                <th>成交量</th>
              </tr>
            </thead>
            <tbody>
              <For each={rows()}>
                {(quote) => (
                  <tr
                    onClick={() => {
                      props.onSelect(quote)
                      props.onClose()
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
                    <td class="num">{compactAmount(quote.amount)}</td>
                    <td class="num">{thousands(quote.volume)}</td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
          <div class="portfolio__empty">
            {rows().length === 0 ? '当前分组还没有行情，等待刷新…' : '点击行切换主行情'}
          </div>
        </div>
      </section>
    </div>
  )
}
