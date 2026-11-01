import { describe, expect, it, vi } from 'vitest'
import type { PushUpdate } from '@shared/types'
import { clampPushInterval, PushHub } from './push'

const minuteTask = { kind: 'minute' as const, code: 'sh600519' }

describe('clampPushInterval', () => {
  it('最短 1 秒，非法值回退 1 秒', () => {
    expect(clampPushInterval(3000)).toBe(3000)
    expect(clampPushInterval(10)).toBe(1000)
    expect(clampPushInterval(Number.NaN)).toBe(1000)
  })
})

describe('PushHub', () => {
  it('订阅后立即推一帧，按间隔重复推，取消后停止', async () => {
    vi.useFakeTimers()
    const updates: PushUpdate[] = []
    const fetcher = vi.fn(async () => ({ ok: true }))
    const hub = new PushHub((update) => updates.push(update), fetcher)

    const id = hub.subscribe(minuteTask, 1000)
    await vi.advanceTimersByTimeAsync(0)
    expect(updates).toHaveLength(1)
    expect(updates[0].id).toBe(id)
    expect(updates[0].data).toEqual({ ok: true })

    await vi.advanceTimersByTimeAsync(1000)
    expect(fetcher).toHaveBeenCalledTimes(2)

    hub.unsubscribe(id)
    await vi.advanceTimersByTimeAsync(5000)
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(hub.size).toBe(0)
    hub.stop()
    vi.useRealTimers()
  })

  it('拉取失败推 error，不丢订阅', async () => {
    vi.useFakeTimers()
    const updates: PushUpdate[] = []
    let fail = true
    const hub = new PushHub(
      (update) => updates.push(update),
      async () => {
        if (fail) throw new Error('网络断开')
        return []
      }
    )
    hub.subscribe(minuteTask, 1000)
    await vi.advanceTimersByTimeAsync(0)
    expect(updates[0].error).toContain('网络断开')
    fail = false
    await vi.advanceTimersByTimeAsync(1000)
    expect(updates[1].error).toBeUndefined()
    hub.stop()
    vi.useRealTimers()
  })

  it('窗口不可见时仍取首帧，之后暂停拉取', async () => {
    vi.useFakeTimers()
    const fetcher = vi.fn(async () => [])
    const hub = new PushHub(
      () => undefined,
      fetcher,
      () => false
    )
    const id = hub.subscribe(minuteTask, 1000)
    await vi.advanceTimersByTimeAsync(0)
    // 启动期 isVisible() 还是 false，但首帧必须出，否则首屏空等
    expect(fetcher).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(5000)
    expect(fetcher).toHaveBeenCalledTimes(1)
    hub.unsubscribe(id)
    vi.useRealTimers()
  })

  it('窗口从不可见变可见后按正常间隔续拉', async () => {
    vi.useFakeTimers()
    let visible = true
    const fetcher = vi.fn(async () => [])
    const hub = new PushHub(
      () => undefined,
      fetcher,
      () => visible
    )
    const id = hub.subscribe(minuteTask, 1000)
    await vi.advanceTimersByTimeAsync(0)
    expect(fetcher).toHaveBeenCalledTimes(1)

    visible = false
    await vi.advanceTimersByTimeAsync(1000)
    expect(fetcher).toHaveBeenCalledTimes(1)

    visible = true
    await vi.advanceTimersByTimeAsync(1000)
    expect(fetcher).toHaveBeenCalledTimes(2)
    hub.unsubscribe(id)
    vi.useRealTimers()
  })
})
