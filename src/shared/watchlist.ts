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

function csvField(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

/** 自选 CSV：一行一只股票，group 列用于分组。 */
export function exportWatchlistCsv(groups: readonly WatchGroup[]): string {
  const lines = ['group,code,name,market']
  for (const group of groups) {
    for (const item of group.items) {
      lines.push([csvField(group.name), item.code, csvField(item.name), item.market].join(','))
    }
  }
  return `${lines.join('\n')}\n`
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = []
  let current = ''
  let quoted = false
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (quoted) {
      if (char === '"' && line[index + 1] === '"') {
        current += '"'
        index += 1
      } else if (char === '"') {
        quoted = false
      } else {
        current += char
      }
    } else if (char === '"') {
      quoted = true
    } else if (char === ',') {
      fields.push(current)
      current = ''
    } else {
      current += char
    }
  }
  fields.push(current)
  return fields
}

/** 解析自选 CSV：group,code,name,market；缺 market 时按代码前缀推断。 */
export function parseWatchlistCsv(text: string): WatchGroup[] {
  const lines = text
    .replace(/^\ufeff/, '')
    .split(/\r?\n/)
    .filter((line) => line.trim())
  if (lines.length === 0) throw new Error('CSV 为空')
  const header = parseCsvLine(lines[0]).map((field) => field.trim().toLowerCase())
  const hasHeader = header.includes('code')
  const indexes = {
    group: hasHeader ? header.indexOf('group') : 0,
    code: hasHeader ? header.indexOf('code') : 1,
    name: hasHeader ? header.indexOf('name') : 2,
    market: hasHeader ? header.indexOf('market') : 3
  }
  const groups = new Map<string, WatchGroup>()
  for (const line of lines.slice(hasHeader ? 1 : 0)) {
    const fields = parseCsvLine(line)
    const code = (fields[indexes.code] ?? '').trim().toLowerCase()
    if (!/^(sh|sz|bj)\d{6}$/.test(code)) continue
    const groupName = (fields[indexes.group] ?? '').trim() || '导入'
    const marketRaw = (fields[indexes.market] ?? '').trim().toUpperCase()
    const market =
      marketRaw === 'SH' || marketRaw === 'SZ' || marketRaw === 'BJ'
        ? marketRaw
        : code.startsWith('sh')
          ? 'SH'
          : code.startsWith('sz')
            ? 'SZ'
            : 'BJ'
    const item: WatchItem = {
      code,
      name: (fields[indexes.name] ?? '').trim() || code.toUpperCase(),
      market
    }
    const group = groups.get(groupName) ?? {
      id: `csv-${Date.now().toString(36)}-${groups.size}`,
      name: groupName,
      items: []
    }
    if (!group.items.some((existing) => existing.code === item.code)) group.items.push(item)
    groups.set(groupName, group)
  }
  if (groups.size === 0) throw new Error('CSV 里没有有效 A 股代码')
  return [...groups.values()]
}
