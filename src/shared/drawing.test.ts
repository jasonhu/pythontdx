import { describe, expect, it } from 'vitest'
import { FIB_RATIOS, fibonacciLevels } from './drawing'

describe('fibonacciLevels', () => {
  it('按固定比例在两端之间插值', () => {
    const levels = fibonacciLevels(100, 200)
    expect(levels).toHaveLength(FIB_RATIOS.length)
    expect(levels[0].price).toBe(100)
    expect(levels[1].price).toBeCloseTo(123.6, 6)
    expect(levels[3].price).toBe(150)
    expect(levels[6].price).toBe(200)
  })

  it('反向绘制时价格区间也反向', () => {
    const levels = fibonacciLevels(200, 100)
    expect(levels[1].price).toBeCloseTo(176.4, 6)
    expect(levels[5].price).toBeCloseTo(121.4, 6)
  })

  it('非法价格返回空表，不画 NaN', () => {
    expect(fibonacciLevels(Number.NaN, 100)).toEqual([])
    expect(fibonacciLevels(100, Number.POSITIVE_INFINITY)).toEqual([])
  })
})
