/**
 * 自选股导入/导出：只处理分组与股票，不带设置、预警、公式等本机状态。
 *
 * 导入采用“追加分组、ID 冲突自动改名”的策略，避免覆盖现有自选。
 */
import type { WatchGroup, WatchItem } from './types'

export interface WatchlistBackup {
  version: 1
  exportedAt: string
  groups: WatchGroup[]
}

function cleanItem(value: unknown): WatchItem | null {
  if (!value || typeof value !== 'object') return null
  const item = value as Partial<WatchItem>
  if (typeof item.code !== 'string' || !/^(sh|sz|bj)\d{6}$/.test(item.code)) return null
  if (typeof item.name !== 'string' || !item.name.trim()) return null
  if (item.market !== 'SH' && item.market !== 'SZ' && item.market !== 'BJ') return null
  return { code: item.code, name: item.name.trim(), market: item.market }
}

function cleanGroup(value: unknown): WatchGroup | null {
  if (!value || typeof value !== 'object') return null
  const group = value as Partial<WatchGroup>
  if (typeof group.name !== 'string' || !group.name.trim()) return null
  if (!Array.isArray(group.items)) return null
  const items = group.items.map(cleanItem).filter((item): item is WatchItem => item !== null)
  return {
    id: typeof group.id === 'string' && group.id ? group.id : `g${Date.now().toString(36)}`,
    name: group.name.trim(),
    items
  }
}

export function exportWatchlist(groups: readonly WatchGroup[], now = new Date()): string {
  const payload: WatchlistBackup = {
    version: 1,
    exportedAt: now.toISOString(),
    groups: groups.map((group) => ({
      id: group.id,
      name: group.name,
      items: group.items.map((item) => ({ ...item }))
    }))
  }
  return JSON.stringify(payload, null, 2)
}

export function parseWatchlist(text: string): WatchGroup[] {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('文件不是合法 JSON')
  }
  const data = raw as Partial<WatchlistBackup>
  if (!data || data.version !== 1 || !Array.isArray(data.groups)) {
    throw new Error('不是 StockLens 自选备份（version=1）')
  }
  const groups = data.groups.map(cleanGroup).filter((group): group is WatchGroup => group !== null)
  if (groups.length === 0) throw new Error('备份里没有有效分组')
  return groups
}

/** 导入分组追加到现有分组后面；ID 冲突时加后缀。 */
export function mergeImportedGroups(
  current: readonly WatchGroup[],
  imported: readonly WatchGroup[]
): WatchGroup[] {
  const used = new Set(current.map((group) => group.id))
  const additions = imported.map((group) => {
    let id = group.id
    let suffix = 1
    while (used.has(id)) {
      suffix += 1
      id = `${group.id}-${suffix}`
    }
    used.add(id)
    return {
      ...group,
      id,
      items: group.items.map((item) => ({ ...item }))
    }
  })
  return [
    ...current.map((group) => ({ ...group, items: group.items.map((item) => ({ ...item })) })),
    ...additions
  ]
}
