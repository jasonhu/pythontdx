/**
 * 关键指标面板：估值、市值、交易活跃度。
 *
 * 行情快照能提供的字段直接用；市盈率/分位/PS/PEG 从 7615 valuation 补，
 * 量比用最近日 K 均量估算。接口暂缺的字段明确显示「—」，不留空白。
 */
import { createEffect, createMemo, createSignal, For, type JSX } from 'solid-js'
import type { Quote } from '@shared/types'
import { compactCap, fixed } from '@shared/format'
import { api } from '../lib/ipc'

export interface StatsGridProps {
  quote: Quote
}

interface StatRow {
  label: string
  value: string
  hint?: string
}

interface ExtraStats {
  peTtm?: number
  pePct?: number
  pb?: number
  pbPct?: number
  ps?: number
  peg?: number
  volumeRatio?: number
}

export function StatsGrid(props: StatsGridProps): JSX.Element {
  const [extra, setExtra] = createSignal<ExtraStats>({})
  const code = createMemo(() => props.quote.code)

  createEffect(() => {
    const currentCode = code()
    setExtra({})
    void (async () => {
      const next: ExtraStats = {}
      try {
        const [valuation, kline] = await Promise.all([
          api.f10.valuation(currentCode).catch(() => null),
          api.trend.kline({ code: currentCode, period: 'day', count: 6 }).catch(() => null)
        ])
        if (valuation && valuation.rows.length > 0) {
          const row = valuation.rows[0]
          const value = (label: string): number | undefined => {
            const index = valuation.columns.indexOf(label)
            const parsed = index >= 0 ? Number(row[index]) : Number.NaN
            return Number.isFinite(parsed) ? parsed : undefined
          }
          next.peTtm = value('PE(TTM)')
          next.pePct = value('PE 分位')
          next.pb = value('PB(MRQ)')
          next.pbPct = value('PB 分位')
          next.ps = value('PS(TTM)')
          next.peg = value('PEG')
        }
        if (kline && kline.bars.length > 1) {
          const history = kline.bars.slice(0, -1).slice(-5)
          const average =
            history.reduce((sum, bar) => sum + bar.volume, 0) / Math.max(1, history.length)
          if (average > 0) next.volumeRatio = props.quote.volume / average
        }
      } catch {
        // 指标面板是辅助信息，单个接口失败不阻断行情主链路。
      }
      setExtra(next)
    })()
  })

  const rows = (): StatRow[] => {
    const { quote } = props
    const limits = limitPrices(quote)
    return [
      { label: '换手率', value: pct(quote.turnoverRate), hint: '成交量 / 流通股本' },
      { label: '振幅', value: pct(quote.amplitude), hint: '(最高 - 最低) / 昨收' },
      {
        label: '量比估算',
        value: fixed(extra().volumeRatio ?? quote.volumeRatio),
        hint: '当前成交量 / 最近 5 日均量；盘中为当日累计估算'
      },
      {
        label: '市盈率 TTM',
        value: fixed(quote.peTtm ?? extra().peTtm),
        hint: '行情快照或 7615 valuation'
      },
      {
        label: 'PE 分位',
        value: pct(extra().pePct),
        hint: '7615 估值分位'
      },
      {
        label: '市净率',
        value: fixed(quote.pb ?? extra().pb),
        hint: '行情快照或 7615 valuation'
      },
      { label: 'PB 分位', value: pct(extra().pbPct), hint: '7615 估值分位' },
      { label: 'PS(TTM)', value: fixed(extra().ps), hint: '7615 valuation' },
      { label: 'PEG', value: fixed(extra().peg), hint: '7615 valuation' },
      { label: '总市值', value: compactCap(quote.totalCap), hint: '现价 × 总股本' },
      { label: '流通市值', value: compactCap(quote.floatCap), hint: '现价 × 流通股本' },
      { label: '均价', value: fixed(quote.avgPrice), hint: '成交额 / 成交量' },
      { label: '涨停价', value: fixed(limits.up), hint: '按板块涨跌幅限制本地计算' },
      { label: '跌停价', value: fixed(limits.down), hint: '按板块涨跌幅限制本地计算' },
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

function limitPrices(quote: Quote): { up?: number; down?: number } {
  if (quote.limitUp !== undefined && quote.limitDown !== undefined) {
    return { up: quote.limitUp, down: quote.limitDown }
  }
  if (!(quote.prevClose > 0)) return {}
  const symbol = quote.symbol
  const limitPct = quote.name.toUpperCase().includes('ST')
    ? 5
    : quote.market === 'BJ'
      ? 30
      : /^(300|301|302|688|689)/.test(symbol)
        ? 20
        : 10
  return {
    up: roundPrice(quote.prevClose * (1 + limitPct / 100)),
    down: roundPrice(quote.prevClose * (1 - limitPct / 100))
  }
}

function roundPrice(value: number): number {
  return Math.round(value * 100) / 100
}
