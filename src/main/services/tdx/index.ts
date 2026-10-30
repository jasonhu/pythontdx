/**
 * 通达信行情门面。
 *
 * 真正的 TCP/协议/解析在 Python 桥接进程里；这里只做：
 *   · 把渲染层的请求翻译成 JSON 命令；
 *   · 缓存 K 线/分时这类低频数据；
 *   · 维护代码表 + 拼音搜索索引。
 */
import type {
  KLinePeriod,
  KLineSeries,
  MinuteTrend,
  MultiDayTrend,
  Quote,
  SearchItem
} from '@shared/types'
import { splitCode } from '@shared/market'
import { TtlCache } from '../cache'
import { CODE_LIST_TIMEOUT_MS, QUOTES_TIMEOUT_MS, TdxBridge, TdxError } from './bridge'
import { buildSearchEntries, searchEntries, type SearchEntry } from './search'
import type { SecurityInfo } from './types'

const bridge = new TdxBridge()

const minuteCache = new TtlCache<MinuteTrend>(10_000)
const fiveDayCache = new TtlCache<MultiDayTrend>(60_000)
const klineCache = new TtlCache<KLineSeries>(60_000)

interface CodeIndex {
  byCode: Map<string, SecurityInfo>
  entries: SearchEntry[]
}

let codeIndex: CodeIndex | null = null
let codeIndexLoading: Promise<CodeIndex> | null = null
let codeIndexFailedAt = 0

/* ------------------------------------------------------------ 代码表 */

async function loadCodeIndex(): Promise<CodeIndex> {
  const all = await bridge.send<SecurityInfo[]>('code_list', {}, CODE_LIST_TIMEOUT_MS)
  return {
    byCode: new Map(all.map((item) => [item.code, item])),
    entries: buildSearchEntries(all)
  }
}

function ensureCodeIndex(): Promise<CodeIndex> {
  if (codeIndex) return Promise.resolve(codeIndex)
  if (codeIndexLoading) return codeIndexLoading

  if (Date.now() - codeIndexFailedAt < 60_000) {
    return Promise.reject(new TdxError('证券代码表暂时不可用，请稍后重试'))
  }

  codeIndexLoading = loadCodeIndex()
    .then((index) => {
      codeIndex = index
      return index
    })
    .catch((error: unknown) => {
      codeIndexFailedAt = Date.now()
      codeIndexLoading = null
      throw error
    })

  return codeIndexLoading
}

/* -------------------------------------------------------------- 实时行情 */

function normalizeCodes(codes: readonly string[]): string[] {
  return [...new Set(codes.map((code) => code.trim().toLowerCase()).filter(Boolean))]
}

/**
 * 批量拉取实时行情。
 *
 * 主链路用 0x0547：首次游标 0 返回五档基线；0x053e 保留兼容/差分。
 * 港股/美股由 Python 侧过滤：整批都不支持会抛错；混合列表只返回 A 股部分。
 */
export async function fetchQuotes(codes: string[], signal?: AbortSignal): Promise<Quote[]> {
  const unique = normalizeCodes(codes)
  if (unique.length === 0) return []
  if (signal?.aborted) throw new TdxError('请求已取消')

  const quotes = await bridge.send<Quote[]>('refresh', { codes: unique }, QUOTES_TIMEOUT_MS)

  const byCode = new Map(quotes.map((quote) => [quote.code, quote]))
  return unique
    .map((code) => byCode.get(code))
    .filter((quote): quote is Quote => quote !== undefined)
}

/* ------------------------------------------------------------------ K 线 */

export async function fetchKline(
  code: string,
  period: KLinePeriod,
  count = 200,
  signal?: AbortSignal
): Promise<KLineSeries> {
  assertSupported(code)
  if (signal?.aborted) throw new TdxError('请求已取消')

  const safeCount = Math.min(800, Math.max(1, Math.trunc(count)))
  const key = `${code}:${period}:${safeCount}`

  return klineCache.resolve(key, () =>
    bridge.send<KLineSeries>('kline', { code, period, count: safeCount })
  )
}

/* ------------------------------------------------------------------ 分时 */

export async function fetchMinuteTrend(code: string, signal?: AbortSignal): Promise<MinuteTrend> {
  assertSupported(code)
  if (signal?.aborted) throw new TdxError('请求已取消')

  return minuteCache.resolve(code, () => bridge.send<MinuteTrend>('minute', { code }))
}

export async function fetchFiveDayTrend(
  code: string,
  signal?: AbortSignal
): Promise<MultiDayTrend> {
  assertSupported(code)
  if (signal?.aborted) throw new TdxError('请求已取消')

  return fiveDayCache.resolve(code, () => bridge.send<MultiDayTrend>('five_day', { code }))
}

/* ------------------------------------------------------------------ 搜索 */

export async function fetchSearchHint(keyword: string): Promise<SearchItem[]> {
  const trimmed = keyword.trim()
  if (!trimmed) return []

  let index: CodeIndex
  try {
    index = await ensureCodeIndex()
  } catch {
    throw new TdxError('证券代码表加载失败，请稍后重试')
  }

  return searchEntries(index.entries, trimmed)
}

/* ------------------------------------------------------------------ 其它 */

function assertSupported(code: string): void {
  const { market } = splitCode(code)
  if (market !== 'SH' && market !== 'SZ' && market !== 'BJ') {
    throw new TdxError('当前数据源暂不支持港股/美股')
  }
}

/** 供「强制刷新」使用：清掉所有行情衍生缓存 */
export function invalidateTrendCache(): void {
  minuteCache.clear()
  fiveDayCache.clear()
  klineCache.clear()
}

/** 应用退出时释放 Python 子进程 */
export function closeTdx(): void {
  bridge.close()
}
