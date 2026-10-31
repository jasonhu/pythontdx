import { describe, expect, it } from 'vitest'
import {
  arrowHeadPoints,
  channelOffset,
  FIB_RATIOS,
  fibonacciLevels,
  measurementBars,
  measurementPercent
} from './drawing'

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

  it('扩展模式追加 127.2% / 161.8%', () => {
    const levels = fibonacciLevels(32.3, 45.72, true)
    expect(levels).toHaveLength(FIB_RATIOS.length + 2)
    expect(levels[7].ratio).toBe(1.272)
    expect(levels[7].price).toBeCloseTo(49.37, 2)
    expect(levels[8].ratio).toBe(1.618)
    expect(levels[8].price).toBeCloseTo(54.01, 2)
  })
})

describe('measurement', () => {
  it('涨跌幅按起点价格计算，负值保留方向', () => {
    expect(measurementPercent(10, 11)).toBeCloseTo(10, 6)
    expect(measurementPercent(10, 9)).toBeCloseTo(-10, 6)
    expect(measurementPercent(0, 9)).toBeNull()
    expect(measurementPercent(Number.NaN, 9)).toBeNull()
  })

  it('根数取两端下标差的绝对值', () => {
    expect(measurementBars(12, 20)).toBe(8)
    expect(measurementBars(20, 12)).toBe(8)
    expect(measurementBars(12, 12)).toBe(0)
  })
})

describe('arrowHeadPoints', () => {
  it('箭头指向终点，两翼在终点后方且对称', () => {
    const points = arrowHeadPoints({ x: 0, y: 0 }, { x: 10, y: 0 }, 8)
    expect(points).toHaveLength(3)
    if (points.length !== 3) return
    expect(points[0]).toEqual({ x: 10, y: 0 })
    expect(points[1].x).toBeLessThan(10)
    expect(points[2].x).toBeLessThan(10)
    expect(points[1].y).toBeCloseTo(-points[2].y, 6)
  })

  it('非法坐标或尺寸返回空数组', () => {
    expect(arrowHeadPoints({ x: 0, y: 0 }, { x: Number.NaN, y: 0 })).toEqual([])
    expect(arrowHeadPoints({ x: 0, y: 0 }, { x: 10, y: 0 }, 0)).toEqual([])
  })
})

describe('channelOffset', () => {
  it('偏移等于第三点减终点', () => {
    expect(channelOffset(10, 12)).toBe(2)
    expect(channelOffset(10, 8)).toBe(-2)
  })

  it('非法价格返回 null', () => {
    expect(channelOffset(Number.NaN, 12)).toBeNull()
    expect(channelOffset(10, Number.POSITIVE_INFINITY)).toBeNull()
  })
})
