/**
 * 本地证券搜索。
 *
 * 通达信 7709 的代码表（0x044d）只有代码 + GBK 名称，没有拼音字段；
 * 官方客户端能按 `gzmt` 搜到贵州茅台，是它在本地维护了拼音索引。
 * 这里用 pinyin-pro 在代码表加载时预计算「全拼 + 首字母」，把同样的能力补回来。
 *
 * 只在主进程运行：渲染层不需要为了搜索把拼音词典打进 bundle。
 */
import { pinyin } from 'pinyin-pro'
import type { SearchItem } from '@shared/types'
import type { SecurityInfo } from './types'

export interface SearchEntry {
  info: SecurityInfo
  /** 全拼，如 guizhoumaotai */
  full: string
  /** 首字母，如 gzmt */
  initials: string
}

interface PinyinIndex {
  full: string
  initials: string
}

/** 去掉空格、标点、全角符号；保留中文与 ASCII 字母数字 */
function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, '')
}

const nameCache = new Map<string, PinyinIndex>()

function pinyinOf(name: string): PinyinIndex {
  const cached = nameCache.get(name)
  if (cached) return cached

  const syllables = pinyin(name, { toneType: 'none', type: 'array' })
    .map((syllable) => normalize(syllable))
    .filter(Boolean)

  const index: PinyinIndex = {
    full: syllables.join(''),
    initials: syllables.map((syllable) => syllable[0] ?? '').join('')
  }
  nameCache.set(name, index)
  return index
}

/** 代码表 → 带拼音的搜索索引；5.2 万条约几十毫秒到几百毫秒 */
export function buildSearchEntries(items: readonly SecurityInfo[]): SearchEntry[] {
  return items.map((info) => ({
    info,
    ...pinyinOf(info.name)
  }))
}

/**
 * 搜索排序：
 *   代码精确 > 代码前缀 > 首字母精确 > 名称前缀 > 全拼前缀 > 首字母前缀
 *   > 代码包含 > 名称包含 > 全拼包含 > 首字母包含
 *
 * 这样 `gzmt`、`guizhou`、`茅台`、`600519` 都能命中贵州茅台，
 * 且精确的首字母/代码不会被长名称里的「包含」挤到后面。
 */
export function searchEntries(
  entries: readonly SearchEntry[],
  keyword: string,
  limit = 20
): SearchItem[] {
  const query = normalize(keyword)
  if (!query) return []

  const matches: Array<{ entry: SearchEntry; score: number }> = []

  for (const entry of entries) {
    const { symbol, code, name } = entry.info
    const lowerCode = code.toLowerCase()
    const lowerName = name.toLowerCase()

    let score: number
    if (symbol === query || lowerCode === query) score = 0
    else if (symbol.startsWith(query)) score = 1
    else if (entry.initials === query) score = 2
    else if (lowerName.startsWith(query)) score = 3
    else if (entry.full.startsWith(query)) score = 4
    else if (entry.initials.startsWith(query)) score = 5
    else if (lowerCode.includes(query)) score = 6
    else if (lowerName.includes(query)) score = 7
    else if (entry.full.includes(query)) score = 8
    else if (entry.initials.includes(query)) score = 9
    else continue

    matches.push({ entry, score })
  }

  matches.sort(
    (left, right) =>
      left.score - right.score || left.entry.info.symbol.localeCompare(right.entry.info.symbol)
  )

  return matches.slice(0, limit).map(({ entry }) => ({
    code: entry.info.code,
    symbol: entry.info.symbol,
    name: entry.info.name,
    market: entry.info.market,
    kind: entry.info.kind
  }))
}
