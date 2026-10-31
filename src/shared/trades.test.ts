import { describe, expect, it } from 'vitest'
import type { TradeTick } from './types'
import { mergeTickPage } from './trades'

function tick(index: number): TradeTick {
  return {
    index,
    timeMinutes: 570,
    time: '09:30:00',
    price: 10 + index / 100,
    volume: 100,
    orderCount: 1,
    status: 0,
    side: 'buy',
    eventKind: 'trade'
  }
}

describe('mergeTickPage', () => {
  it('更旧的一页拼到前面并保持正序', () => {
    const current = [tick(1800), tick(1801)]
    const older = [tick(0), tick(1)]
    const result = mergeTickPage(current, older)
    expect(result.added).toBe(2)
    expect(result.ticks.map((item) => item.index)).toEqual([0, 1, 1800, 1801])
  })

  it('重复页不改变结果，调用方可据此停止分页', () => {
    const current = [tick(0), tick(1)]
    const result = mergeTickPage(current, [tick(0), tick(1)])
    expect(result.added).toBe(0)
    expect(result.ticks.map((item) => item.index)).toEqual([0, 1])
  })
})
