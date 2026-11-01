import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BREADTH_DELAY_MS, BREADTH_INTERVAL_MS, scheduleBreadth } from './breadth'

describe('scheduleBreadth', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('未 live 时不启动任何请求', () => {
    const load = vi.fn()
    for (const status of ['idle', 'connecting', 'error']) {
      const cancel = scheduleBreadth(status, load)
      vi.advanceTimersByTime(120_000)
      cancel()
    }
    expect(load).not.toHaveBeenCalled()
  })

  it('首帧行情后延迟加载，再按间隔轮询', () => {
    const load = vi.fn()
    const cancel = scheduleBreadth('live', load)

    vi.advanceTimersByTime(BREADTH_DELAY_MS - 1)
    expect(load).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(load).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(BREADTH_INTERVAL_MS)
    expect(load).toHaveBeenCalledTimes(2)

    cancel()
    vi.advanceTimersByTime(BREADTH_INTERVAL_MS * 3)
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('取消后不再触发', () => {
    const load = vi.fn()
    const cancel = scheduleBreadth('live', load, { delayMs: 100 })
    vi.advanceTimersByTime(100)
    expect(load).toHaveBeenCalledTimes(1)

    cancel()
    vi.advanceTimersByTime(60_000)
    expect(load).toHaveBeenCalledTimes(1)
  })
})
