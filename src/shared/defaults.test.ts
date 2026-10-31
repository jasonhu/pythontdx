import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from './types'

describe('DEFAULT_SETTINGS', () => {
  it('默认 1 秒刷新', () => {
    expect(DEFAULT_SETTINGS.refreshInterval).toBe(1000)
  })

  it('默认五条均线且只显示均线', () => {
    expect(DEFAULT_SETTINGS.maPeriods).toEqual([5, 10, 20, 60, 120])
    expect(DEFAULT_SETTINGS.subIndicator).toBe('none')
    expect(DEFAULT_SETTINGS.showBoll).toBe(false)
    expect(DEFAULT_SETTINGS.showDrawings).toBe(false)
    expect(DEFAULT_SETTINGS.showAverages).toBe(true)
    expect(DEFAULT_SETTINGS.mainFormula).toBeUndefined()
  })
})
