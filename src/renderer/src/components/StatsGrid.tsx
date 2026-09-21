/**
 * 关键指标面板：估值、市值、交易活跃度。
 */
import { For, type JSX } from 'solid-js'
import type { Quote } from '@shared/types'
import { compactCap, fixed } from '@shared/format'

export interface StatsGridProps {
  quote: Quote
}

interface StatRow {
  label: string
  value: string
  hint?: string
}

export function StatsGrid(props: StatsGridProps): JSX.Element {
  const rows = (): StatRow[] => {
    const { quote } = props
    return [
      { label: '换手率', value: pct(quote.turnoverRate), hint: '成交量 / 流通股本' },
      { label: '振幅', value: pct(quote.amplitude), hint: '(最高 - 最低) / 昨收' },
      { label: '量比', value: fixed(quote.volumeRatio), hint: '当前成交量 / 近期均量' },
      { label: '市盈率 TTM', value: fixed(quote.peTtm) },
      { label: '市盈率 静', value: fixed(quote.peStatic) },
      { label: '市净率', value: fixed(quote.pb) },
      { label: '总市值', value: compactCap(quote.totalCap) },
      { label: '流通市值', value: compactCap(quote.floatCap) },
      { label: '均价', value: fixed(quote.avgPrice) },
      { label: '涨停价', value: fixed(quote.limitUp) },
      { label: '跌停价', value: fixed(quote.limitDown) },
      { label: '昨收', value: fixed(quote.prevClose) }
    ]
  }

  return (
    <div class="stats">
      <For each={rows()}>
        {(row) => (
          <div class="stats__item" title={row.hint}>
            <span class="stats__label">{row.label}</span>
            <span class="stats__value num">{row.value}</span>
          </div>
        )}
      </For>
    </div>
  )
}

function pct(value: number | undefined): string {
  return value === undefined ? '—' : `${value.toFixed(2)}%`
}
