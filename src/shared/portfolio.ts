/** 组合持仓的纯计算：不碰网络、不碰 Solid。 */
import type { PortfolioPosition, Quote } from './types'

export interface PositionRow {
  code: string
  name: string
  price: number
  changePct: number
  shares: number
  cost: number
  marketValue: number
  costValue: number
  pnl: number
  pnlPct: number
  weight: number
}

export interface PortfolioSummary {
  rows: PositionRow[]
  totalValue: number
  totalCost: number
  pnl: number
  pnlPct: number
}

export function computePortfolio(
  quotes: readonly Quote[],
  positions: readonly PortfolioPosition[]
): PortfolioSummary {
  const byCode = new Map(quotes.map((quote) => [quote.code, quote]))
  const rows: PositionRow[] = []
  for (const position of positions) {
    if (!Number.isFinite(position.shares) || position.shares <= 0) continue
    const quote = byCode.get(position.code)
    const price = quote?.price && quote.price > 0 ? quote.price : position.cost
    const marketValue = price * position.shares
    const costValue = position.cost * position.shares
    rows.push({
      code: position.code,
      name: quote?.name ?? position.code.toUpperCase(),
      price,
      changePct: quote?.changePct ?? 0,
      shares: position.shares,
      cost: position.cost,
      marketValue,
      costValue,
      pnl: marketValue - costValue,
      pnlPct: costValue > 0 ? ((marketValue - costValue) / costValue) * 100 : 0,
      weight: 0
    })
  }
  const totalValue = rows.reduce((sum, row) => sum + row.marketValue, 0)
  const totalCost = rows.reduce((sum, row) => sum + row.costValue, 0)
  for (const row of rows) row.weight = totalValue > 0 ? (row.marketValue / totalValue) * 100 : 0
  return {
    rows,
    totalValue,
    totalCost,
    pnl: totalValue - totalCost,
    pnlPct: totalCost > 0 ? ((totalValue - totalCost) / totalCost) * 100 : 0
  }
}
