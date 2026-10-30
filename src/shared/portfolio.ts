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

export interface PositionSimulation {
  dates: string[]
  curve: number[]
  cost: number
  finalValue: number
  pnl: number
  pnlPct: number
  maxDrawdown: number
}

/**
 * 按“当前持股数”回溯各标的收盘价，模拟持仓市值曲线。
 *
 * 不是历史成交回放：只回答“如果这些股数一直持有到现在，市值怎么走”。
 * 停牌日沿用上一收盘；没有可用 K 线的标的按成本计入。
 */
export function simulatePositions(
  series: ReadonlyArray<{ code: string; bars: ReadonlyArray<{ date: string; close: number }> }>,
  positions: readonly PortfolioPosition[]
): PositionSimulation {
  const active = positions.filter((position) => position.shares > 0)
  const cost = active.reduce((sum, position) => sum + position.shares * position.cost, 0)
  const byCode = new Map(series.map((item) => [item.code, item.bars]))
  const dateSet = new Set<string>()
  for (const item of series) for (const bar of item.bars) dateSet.add(bar.date)
  const dates = [...dateSet].sort()
  const lastPrice = new Map<string, number>()
  for (const position of active) lastPrice.set(position.code, position.cost)
  const curve: number[] = []
  let peak = 0
  let maxDrawdown = 0
  for (const date of dates) {
    let value = 0
    for (const position of active) {
      const bars = byCode.get(position.code) ?? []
      const bar = bars.find((item) => item.date === date)
      if (bar && bar.close > 0) lastPrice.set(position.code, bar.close)
      value += position.shares * (lastPrice.get(position.code) ?? position.cost)
    }
    curve.push(value)
    peak = Math.max(peak, value)
    maxDrawdown = Math.max(maxDrawdown, peak > 0 ? (peak - value) / peak : 0)
  }
  const finalValue = curve.at(-1) ?? cost
  return {
    dates,
    curve,
    cost,
    finalValue,
    pnl: finalValue - cost,
    pnlPct: cost > 0 ? ((finalValue - cost) / cost) * 100 : 0,
    maxDrawdown: maxDrawdown * 100
  }
}
