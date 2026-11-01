/**
 * 本地证券搜索（桌面主进程与 Web 共用）。
 *
 * 通达信 7709 的代码表（0x044d）只有代码 + GBK 名称，没有拼音字段；
 * 官方客户端能按 `gzmt` 搜到贵州茅台，是它在本地维护了拼音索引。
 * 这里用 pinyin-pro 预计算「全拼 + 首字母」，把同样的能力补回来。
 */
import { pinyin } from 'pinyin-pro'
import type { Market, SearchItem } from './types'

/** 搜索所需的最小证券字段；终端 SecurityInfo 结构兼容。 */
export interface SearchSecurity {
  code: string
  market: Market
  symbol: string
  name: string
  kind: string
}

export interface SearchEntry {
  info: SearchSecurity
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
export function buildSearchEntries(items: readonly SearchSecurity[]): SearchEntry[] {
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

/**
 * 单条证券是否命中拼音（全拼或首字母，前缀优先、也允许包含）。
 *
 * `searchEntries` 用于「搜索框给前 20 条」；全市场列表要保留全部命中行，
 * 所以把拼音判断单独抽出来复用，保证两处规则一致。
 */
export function matchesPinyin(entry: SearchEntry, keyword: string): boolean {
  const query = normalize(keyword)
  if (!query) return false
  return (
    entry.initials.startsWith(query) ||
    entry.full.startsWith(query) ||
    entry.initials.includes(query) ||
    entry.full.includes(query)
  )
}
