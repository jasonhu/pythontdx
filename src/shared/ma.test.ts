import { describe, expect, it } from 'vitest'
import { DEFAULT_MA_PERIODS, normalizeMaPeriods } from './ma'

describe('normalizeMaPeriods', () => {
  it('缺省使用五条默认均线', () => {
    expect(normalizeMaPeriods()).toEqual([...DEFAULT_MA_PERIODS])
  })

  it('旧三条设置补齐 60/120', () => {
    expect(normalizeMaPeriods([5, 10, 20])).toEqual([5, 10, 20, 60, 120])
  })

  it('非法值回退并限制上限', () => {
    expect(normalizeMaPeriods([8, 0, 21, 999, Number.NaN])).toEqual([8, 10, 21, 250, 120])
  })
})
