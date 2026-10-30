/** 涨跌停/炸板的本地判定：只用于列表筛选，不生成交易指令。 */
import type { Quote } from './types'

export type LimitKind = 'up' | 'down' | 'broken'

export interface LimitQuote {
  code: string
  name: string
  price: number
  prevClose: number
  high: number
  low: number
  changePct: number
  amount: number
}

/** A 股涨跌幅限制：主板 10%、创业板/科创板 20%、北交所 30%、主板 ST 5%。 */
export function limitPercent(code: string, name: string): number {
  const symbol = code.replace(/^(sh|sz|bj)/i, '')
  if (/^bj/i.test(code) || /^[489]/.test(symbol)) return 30
  if (/^(300|301|302|688|689)/.test(symbol)) return 20
  if (name.toUpperCase().includes('ST')) return 5
  return 10
}

function roundPrice(value: number): number {
  return Math.round(value * 100) / 100
}

export function limitPrices(
  code: string,
  name: string,
  prevClose: number
): {
  up: number
  down: number
} {
  const pct = limitPercent(code, name)
  return {
    up: roundPrice(prevClose * (1 + pct / 100)),
    down: roundPrice(prevClose * (1 - pct / 100))
  }
}

export function classifyLimit(quote: LimitQuote): LimitKind | null {
  if (!(quote.prevClose > 0) || !(quote.price > 0)) return null
  const { up, down } = limitPrices(quote.code, quote.name, quote.prevClose)
  if (quote.high >= up - 0.005) return quote.price >= up - 0.005 ? 'up' : 'broken'
  if (quote.low <= down + 0.005) return 'down'
  return null
}

export function limitRowsFromQuotes(quotes: readonly Quote[], kind: LimitKind): LimitQuote[] {
  const rows: LimitQuote[] = []
  for (const quote of quotes) {
    const row: LimitQuote = {
      code: quote.code,
      name: quote.name,
      price: quote.price,
      prevClose: quote.prevClose,
      high: quote.high,
      low: quote.low,
      changePct: quote.changePct,
      amount: quote.amount
    }
    if (classifyLimit(row) === kind) rows.push(row)
  }
  rows.sort((a, b) =>
    kind === 'down'
      ? a.changePct - b.changePct
      : kind === 'broken'
        ? b.amount - a.amount
        : b.changePct - a.changePct
  )
  return rows
}
