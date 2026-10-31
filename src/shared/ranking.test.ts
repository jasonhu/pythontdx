import { describe, expect, it } from 'vitest'
import type { CategoryQuote, MacMoneyFlowPoint } from './types'
import { amplitudePercent, filterCapQuotes, formatNetFlow, mergeMoneyFlowRanking } from './ranking'

function quote(code: string, amount: number): CategoryQuote {
  return {
    code,
    symbol: code.slice(2),
    name: code,
    market: code.startsWith('sh') ? 'SH' : 'SZ',
    price: 10,
    prevClose: 10,
    open: 10,
    high: 10,
    low: 10,
    change: 0,
    changePct: 0,
    volume: 100,
    amount,
    currency: 'CNY',
    time: 1,
    bids: [],
    asks: [],
    receivedAt: 1
  }
}

function flow(code: string, mainNet: number, largeNet5d = 0): MacMoneyFlowPoint {
  return {
    code,
    mainIn: mainNet > 0 ? mainNet : 0,
    mainOut: mainNet < 0 ? -mainNet : 0,
    mainNet,
    retailIn: 0,
    retailOut: 0,
    retailNet: 0,
    largeNet5d,
    midNet5d: 0,
    receivedAt: 1
  }
}

describe('mergeMoneyFlowRanking', () => {
  it('按主力净流入降序合并，并计算占成交额比例', () => {
    const result = mergeMoneyFlowRanking(
      [quote('sh600000', 1_000_000), quote('sz000001', 2_000_000)],
      [flow('sh600000', 50_000), flow('sz000001', -100_000)]
    )
    expect(result.quotes.map((item) => item.code)).toEqual(['sh600000', 'sz000001'])
    expect(result.quotes[0].mainNet).toBe(50_000)
    expect(result.quotes[0].mainRatio).toBe(5)
    expect(result.quotes[1].mainRatio).toBe(-5)
    expect(result.matched).toBe(2)
    expect(result.total).toBe(2)
  })

  it('缺少资金流或重复报价不进入榜单', () => {
    const result = mergeMoneyFlowRanking(
      [quote('sh600000', 1), quote('sh600000', 2), quote('sz000001', 3)],
      [flow('sh600000', 1)]
    )
    expect(result.quotes).toHaveLength(1)
    expect(result.quotes[0].code).toBe('sh600000')
    expect(result.matched).toBe(1)
    expect(result.total).toBe(2)
  })

  it('净流入相同按成交额降序，保证名次稳定', () => {
    const result = mergeMoneyFlowRanking(
      [quote('sh600000', 1), quote('sz000001', 9)],
      [flow('sh600000', 10), flow('sz000001', 10)]
    )
    expect(result.quotes.map((item) => item.code)).toEqual(['sz000001', 'sh600000'])
  })
})

describe('formatNetFlow', () => {
  it('按亿/万缩写并保留负号', () => {
    expect(formatNetFlow(123_456_789)).toBe('1.23 亿')
    expect(formatNetFlow(-12_345)).toBe('-1.23 万')
    expect(formatNetFlow(42)).toBe('42')
    expect(formatNetFlow(Number.NaN)).toBe('—')
  })
})

describe('amplitudePercent', () => {
  it('按 (最高-最低)/昨收 计算，缺失昨收返回 0', () => {
    expect(amplitudePercent({ high: 11, low: 9, prevClose: 10 })).toBeCloseTo(20, 6)
    expect(amplitudePercent({ high: 11, low: 9, prevClose: 0 })).toBe(0)
    expect(amplitudePercent({ high: 9, low: 11, prevClose: 10 })).toBe(0)
  })
})

describe('filterCapQuotes', () => {
  it('剔除市值缺失/为 0 的报价并计数', () => {
    const rows = [
      { ...quote('sh600000', 1), floatCap: 100 },
      { ...quote('sh600001', 1), floatCap: 0 },
      { ...quote('sh600002', 1) }
    ]
    const result = filterCapQuotes(rows, 'floatCap')
    expect(result.quotes.map((item) => item.code)).toEqual(['sh600000'])
    expect(result.missing).toBe(2)
  })

  it('全部缺失时返回空表，界面可显示财务不可用', () => {
    const result = filterCapQuotes([quote('sh600000', 1)], 'totalCap')
    expect(result.quotes).toEqual([])
    expect(result.missing).toBe(1)
  })
})
