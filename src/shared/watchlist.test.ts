import { describe, expect, it } from 'vitest'
import type { WatchGroup } from './types'
import { exportWatchlist, mergeImportedGroups, parseWatchlist } from './watchlist'

const GROUPS: WatchGroup[] = [
  {
    id: 'default',
    name: '自选',
    items: [{ code: 'sh600519', name: '贵州茅台', market: 'SH' }]
  }
]

describe('watchlist backup', () => {
  it('导出再导入保持分组与代码', () => {
    const text = exportWatchlist(GROUPS, new Date('2026-10-30T00:00:00Z'))
    const parsed = parseWatchlist(text)
    expect(parsed).toHaveLength(1)
    expect(parsed[0]?.items[0]?.code).toBe('sh600519')
    expect(text).toContain('2026-10-30')
  })

  it('拒绝非备份/坏 JSON', () => {
    expect(() => parseWatchlist('not json')).toThrow()
    expect(() => parseWatchlist('{"version":2,"groups":[]}')).toThrow()
  })

  it('导入 ID 冲突自动改名且追加', () => {
    const merged = mergeImportedGroups(GROUPS, [
      { id: 'default', name: '导入', items: [] },
      { id: 'x', name: '新组', items: [] }
    ])
    expect(merged.map((group) => group.id)).toEqual(['default', 'default-2', 'x'])
    expect(merged).toHaveLength(3)
  })
})
