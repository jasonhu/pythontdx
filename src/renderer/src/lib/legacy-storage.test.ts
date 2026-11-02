import { describe, expect, it, vi } from 'vitest'
import { migrateLegacyLocalStorage } from './legacy-storage'

function fakeStorage(values: Record<string, string>) {
  const data = new Map(Object.entries(values))
  return {
    get length() {
      return data.size
    },
    key: (index: number) => Array.from(data.keys())[index] ?? null,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
    removeItem: (key: string) => data.delete(key),
    clear: () => data.clear()
  }
}

describe('旧 localStorage 键迁移', () => {
  it('复制旧前缀，不覆盖已存在的旧键，也不删除旧键', () => {
    vi.stubGlobal(
      'localStorage',
      fakeStorage({
        'stocklens.quote-cache-v1': 'quote',
        'stocklens.trend-cache-v1-minute': 'trend',
        'pythontdx.quote-cache-v1': 'newer',
        'other': 'keep'
      })
    )
    expect(migrateLegacyLocalStorage()).toBe(1)
    expect(localStorage.getItem('pythontdx.quote-cache-v1')).toBe('newer')
    expect(localStorage.getItem('pythontdx.trend-cache-v1-minute')).toBe('trend')
    expect(localStorage.getItem('stocklens.quote-cache-v1')).toBe('quote')
    vi.unstubAllGlobals()
  })
})
