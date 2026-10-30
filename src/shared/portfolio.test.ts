import { describe, expect, it } from 'vitest'
import type { PortfolioPosition, Quote } from './types'
import { computePortfolio } from './portfolio'

function quote(code: string, price: number): Quote {
  return {
    code,
    name: code,
    market: 'SH',
    symbol: code.slice(2),
    kind: 'GP-A',
    price,
    open: price,
    high: price,
    low: price,
    preClose: price,
    change: 0,
    changePct: 0,
    volume: 0,
    amount: 0,
    bid: [],
    ask: [],
    time: '15:00'
  } as unknown as Quote
}

describe('computePortfolio', () => {
  it('按现价计算市值/盈亏/权重', () => {
    const positions: PortfolioPosition[] = [
      { code: 'sh600519', shares: 100, cost: 10 },
      { code: 'sz000001', shares: 200, cost: 5 }
    ]
    const result = computePortfolio([quote('sh600519', 20), quote('sz000001', 4)], positions)
    expect(result.totalValue).toBe(2800)
    expect(result.totalCost).toBe(2000)
    expect(result.pnl).toBe(800)
    expect(result.rows[0].weight).toBeCloseTo((2000 / 2800) * 100, 4)
  })

  it('忽略零/负持仓与缺行情', () => {
    const positions: PortfolioPosition[] = [
      { code: 'sh600519', shares: 0, cost: 10 },
      { code: 'sh600000', shares: 10, cost: 8 }
    ]
    const result = computePortfolio([], positions)
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].marketValue).toBe(80)
  })
})
