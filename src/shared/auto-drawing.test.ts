import { describe, expect, it } from 'vitest'
import { buildSmartDrawings } from './auto-drawing'
import type { KLineBar } from './types'

function bar(date: string, close: number): KLineBar {
  return { date, open: close, high: close + 1, low: close - 1, close, volume: 1000 }
}

function zigzag(): KLineBar[] {
  const values = [
    30, 31, 32, 35, 38, 42, 45, 50, 55, 60, 58, 54, 50, 46, 42, 38, 34, 30, 28, 26, 24, 22, 20, 22,
    24, 28, 32, 36, 40, 44, 48, 52, 56, 60, 58, 54, 50, 46, 42, 38, 34, 30, 32, 34, 36, 38
  ]
  return values.map((value, index) => bar(`2026-01-${String(index + 1).padStart(2, '0')}`, value))
}

describe('buildSmartDrawings', () => {
  it('生成斐波那契、趋势、通道和水平线组合', () => {
    const plans = buildSmartDrawings(zigzag())
    expect(plans.map((plan) => plan.type)).toEqual(['fib', 'trend', 'channel', 'horizontal'])
    for (const plan of plans) {
      if (plan.startIndex !== undefined) expect(Number.isInteger(plan.startIndex)).toBe(true)
      if (plan.endIndex !== undefined) expect(Number.isInteger(plan.endIndex)).toBe(true)
    }
    expect(plans.find((plan) => plan.type === 'channel')?.offset).not.toBe(0)
  })

  it('数据不足或没有有效范围时返回空数组', () => {
    expect(buildSmartDrawings([])).toEqual([])
    expect(buildSmartDrawings([bar('2026-01-01', 10)])).toEqual([])
    expect(
      buildSmartDrawings(
        Array.from({ length: 40 }, (_, index) =>
          bar(`2026-02-${String(index + 1).padStart(2, '0')}`, 10)
        )
      )
    ).toEqual([])
  })
})
