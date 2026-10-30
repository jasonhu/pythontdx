import { describe, expect, it } from 'vitest'
import { classifyLimit, limitPercent, limitPrices, limitRowsFromQuotes } from './limits'
import type { Quote } from './types'

function quote(partial: Partial<Quote> & Pick<Quote, 'code' | 'name'>): Quote {
  return {
    symbol: partial.code.slice(2),
    market: 'SH',
    price: 10,
    prevClose: 10,
    open: 10,
    high: 10,
    low: 10,
    change: 0,
    changePct: 0,
    volume: 0,
    amount: 0,
    currency: 'CNY',
    time: 0,
    receivedAt: 0,
    ...partial
  } as unknown as Quote
}

describe('limits', () => {
  it('按板块与 ST 返回涨跌幅限制', () => {
    expect(limitPercent('sh600000', '浦发银行')).toBe(10)
    expect(limitPercent('sz300001', '特锐德')).toBe(20)
    expect(limitPercent('sh688001', '华兴源创')).toBe(20)
    expect(limitPercent('bj920001', '北交所')).toBe(30)
    expect(limitPercent('sh600001', 'ST测试')).toBe(5)
  })

  it('涨停 / 炸板 / 跌停', () => {
    expect(
      classifyLimit({
        code: 'sh600000',
        name: '浦发银行',
        price: 11,
        prevClose: 10,
        high: 11,
        low: 10,
        changePct: 10,
        amount: 1
      })
    ).toBe('up')
    expect(
      classifyLimit({
        code: 'sh600000',
        name: '浦发银行',
        price: 10.8,
        prevClose: 10,
        high: 11,
        low: 10,
        changePct: 8,
        amount: 1
      })
    ).toBe('broken')
    expect(
      classifyLimit({
        code: 'sh600000',
        name: '浦发银行',
        price: 9,
        prevClose: 10,
        high: 10,
        low: 9,
        changePct: -10,
        amount: 1
      })
    ).toBe('down')
    expect(
      classifyLimit({
        code: 'sh600000',
        name: '浦发银行',
        price: 10.2,
        prevClose: 10,
        high: 10.3,
        low: 10,
        changePct: 2,
        amount: 1
      })
    ).toBeNull()
  })

  it('涨停价按分四舍五入', () => {
    expect(limitPrices('sh600000', '浦发银行', 9.87)).toEqual({ up: 10.86, down: 8.88 })
  })

  it('批量筛选并排序', () => {
    const quotes = [
      quote({
        code: 'sh600001',
        name: 'A',
        price: 11,
        prevClose: 10,
        high: 11,
        low: 10,
        changePct: 10
      }),
      quote({
        code: 'sh600002',
        name: 'B',
        price: 10.8,
        prevClose: 10,
        high: 11,
        low: 10,
        changePct: 8
      })
    ]
    expect(limitRowsFromQuotes(quotes, 'up').map((row) => row.code)).toEqual(['sh600001'])
    expect(limitRowsFromQuotes(quotes, 'broken').map((row) => row.code)).toEqual(['sh600002'])
  })
})
