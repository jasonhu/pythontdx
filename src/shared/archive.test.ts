import { describe, expect, it } from 'vitest'
import { localDateKey, shouldAutoArchive } from './archive'

describe('shouldAutoArchive', () => {
  const tradingDay = new Date(2026, 9, 30, 15, 10)

  it('工作日收盘窗口且今日未归档时触发', () => {
    expect(shouldAutoArchive(tradingDay, true, undefined)).toBe(true)
    expect(shouldAutoArchive(tradingDay, true, '2026-10-29')).toBe(true)
  })

  it('同一天只触发一次', () => {
    expect(shouldAutoArchive(tradingDay, true, localDateKey(tradingDay))).toBe(false)
  })

  it('关闭、周末、窗口外不触发', () => {
    expect(shouldAutoArchive(tradingDay, false, undefined)).toBe(false)
    expect(shouldAutoArchive(new Date(2026, 9, 31, 15, 10), true, undefined)).toBe(false)
    expect(shouldAutoArchive(new Date(2026, 9, 30, 14, 59), true, undefined)).toBe(false)
    expect(shouldAutoArchive(new Date(2026, 9, 30, 15, 41), true, undefined)).toBe(false)
  })
})
