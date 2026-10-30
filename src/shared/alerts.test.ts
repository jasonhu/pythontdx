import { describe, expect, it } from 'vitest'
import type { AlertRule, Quote } from './types'
import { evaluateAlerts, localDate } from './alerts'

function quote(code: string, price: number, changePct: number, extra: Partial<Quote> = {}): Quote {
  return { code, name: code, price, changePct, ...extra } as Quote
}

function rule(overrides: Partial<AlertRule> = {}): AlertRule {
  return {
    id: 'a1',
    code: 'sh600519',
    name: '贵州茅台',
    metric: 'price',
    direction: 'above',
    value: 1300,
    enabled: true,
    ...overrides
  }
}

const NOW = new Date('2026-10-30T10:00:00+08:00').getTime()

describe('evaluateAlerts', () => {
  it('价格上穿触发，并标记当日已触发', () => {
    const scan = evaluateAlerts([rule()], [quote('sh600519', 1367.85, 1.02)], NOW)
    expect(scan.events).toHaveLength(1)
    expect(scan.events[0]?.message).toContain('1367.85')
    expect(scan.updated[0]?.lastTriggeredDate).toBe(localDate(NOW))
  })

  it('同一规则同一天不重复触发', () => {
    const scan = evaluateAlerts(
      [rule({ lastTriggeredDate: localDate(NOW) })],
      [quote('sh600519', 1400, 2)],
      NOW
    )
    expect(scan.events).toEqual([])
    expect(scan.updated).toEqual([])
  })

  it('涨幅下穿、禁用和未匹配行情都不触发', () => {
    const pct = rule({ metric: 'changePct', direction: 'below', value: -3 })
    expect(evaluateAlerts([pct], [quote('sh600519', 100, -3.5)], NOW).events).toHaveLength(1)
    expect(
      evaluateAlerts([{ ...pct, enabled: false }], [quote('sh600519', 100, -5)], NOW).events
    ).toHaveLength(0)
    expect(evaluateAlerts([pct], [quote('sz000858', 100, -5)], NOW).events).toHaveLength(0)
  })

  it('多条件必须全部满足，消息用「且」连接', () => {
    const combo = rule({
      value: 100,
      conditions: [
        { metric: 'price', direction: 'above', value: 100 },
        { metric: 'changePct', direction: 'above', value: 2 }
      ]
    })
    expect(evaluateAlerts([combo], [quote('sh600519', 150, 1.5)], NOW).events).toHaveLength(0)
    const scan = evaluateAlerts([combo], [quote('sh600519', 150, 2.1)], NOW)
    expect(scan.events).toHaveLength(1)
    expect(scan.events[0]?.message).toContain('且')
  })

  it('三条件组合全部满足才触发', () => {
    const combo = rule({
      conditions: [
        { metric: 'price', direction: 'above', value: 100 },
        { metric: 'changePct', direction: 'above', value: 1 },
        { metric: 'volumeRatio', direction: 'above', value: 2 }
      ]
    })
    expect(
      evaluateAlerts([combo], [quote('sh600519', 150, 1.5, { volumeRatio: 1.5 })], NOW).events
    ).toHaveLength(0)
    const scan = evaluateAlerts([combo], [quote('sh600519', 150, 1.5, { volumeRatio: 2.5 })], NOW)
    expect(scan.events).toHaveLength(1)
  })

  it('量比预警使用可选字段并带上 x 单位', () => {
    const volume = rule({ metric: 'volumeRatio', direction: 'above', value: 2 })
    const scan = evaluateAlerts([volume], [quote('sh600519', 100, 1, { volumeRatio: 2.5 })], NOW)
    expect(scan.events).toHaveLength(1)
    expect(scan.events[0]?.message).toContain('量比')
    expect(scan.events[0]?.message).toContain('2.50x')
    expect(evaluateAlerts([volume], [quote('sh600519', 100, 1)], NOW).events).toHaveLength(0)
  })
})
