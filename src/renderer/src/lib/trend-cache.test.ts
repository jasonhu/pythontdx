import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MinuteTrend, MultiDayTrend } from '@shared/types'
import { readTrendCache, writeTrendCache } from './trend-cache'

class MemoryStorage implements Storage {
  private readonly data = new Map<string, string>()

  get length(): number {
    return this.data.size
  }

  clear(): void {
    this.data.clear()
  }

  getItem(key: string): string | null {
    return this.data.get(key) ?? null
  }

  key(index: number): string | null {
    return [...this.data.keys()][index] ?? null
  }

  removeItem(key: string): void {
    this.data.delete(key)
  }

  setItem(key: string, value: string): void {
    this.data.set(key, value)
  }
}

function minute(code = 'sh000001', name = '上证指数', date = '20261030'): MinuteTrend {
  return {
    code,
    name,
    date,
    prevClose: 3651.43,
    points: [{ time: '09:31', price: 3595.72, avg: 3584.6792, volume: 3809805 }]
  }
}

function fiveDay(code = 'sh000001'): MultiDayTrend {
  return { code, name: '上证指数', days: [minute(code)] }
}

describe('trend-cache', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', new MemoryStorage())
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('分时快照可写入/回读', () => {
    const data = minute()
    writeTrendCache('minute', data.code, data)
    const cached = readTrendCache<MinuteTrend>('minute', data.code)
    expect(cached?.data).toEqual(data)
    expect(cached?.savedAt).toBe(1_000_000)
  })

  it('五日分时快照可写入/回读', () => {
    const data = fiveDay()
    writeTrendCache('five', data.code, data)
    expect(readTrendCache<MultiDayTrend>('five', data.code)?.data).toEqual(data)
  })

  it('代码不匹配或 JSON 损坏时返回 null', () => {
    writeTrendCache('minute', 'sh000001', minute('sh000001'))
    expect(readTrendCache('minute', 'sz399001')).toBeNull()

    localStorage.setItem('stocklens.trend-cache-v1-minute', '{bad json')
    expect(readTrendCache('minute', 'sh000001')).toBeNull()
  })

  it('同一代码 2 秒内不重复写，避免推送每帧序列化', () => {
    writeTrendCache('minute', 'sh000001', minute('sh000001', '旧名字'))
    writeTrendCache('minute', 'sh000001', minute('sh000001', '新名字'))
    expect(readTrendCache<MinuteTrend>('minute', 'sh000001')?.data.name).toBe('旧名字')

    vi.setSystemTime(1_002_001)
    writeTrendCache('minute', 'sh000001', minute('sh000001', '新名字'))
    expect(readTrendCache<MinuteTrend>('minute', 'sh000001')?.data.name).toBe('新名字')
  })

  it('只保留最近 12 个分时快照', () => {
    for (let index = 0; index < 15; index += 1) {
      vi.setSystemTime(1_000_000 + index * 3_000)
      const code = `sh${String(index).padStart(6, '0')}`
      writeTrendCache('minute', code, minute(code))
    }
    expect(readTrendCache('minute', 'sh000000')).toBeNull()
    expect(readTrendCache('minute', 'sh000014')).not.toBeNull()
  })
})
