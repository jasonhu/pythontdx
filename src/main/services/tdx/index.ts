/**
 * 通达信行情门面。
 *
 * 真正的 TCP/协议/解析在 Python 桥接进程里；这里只做：
 *   · 把渲染层的请求翻译成 JSON 命令；
 *   · 缓存 K 线/分时这类低频数据；
 *   · 维护代码表 + 拼音搜索索引。
 */
import type {
  AuctionPoint,
  BlockKind,
  BlockList,
  CategoryQuote,
  F10Section,
  IndustryList,
  KLinePeriod,
  KLineSeries,
  MinuteTrend,
  MoneyFlowRecord,
  MultiDayTrend,
  Quote,
  ScreenRequest,
  ScreenResult,
  SearchItem,
  StatsCsvExport,
  StatsQueryResult,
  TdxStatsExport,
  TdxStatsSummary,
  TradeTick
} from '@shared/types'
import type { CategoryRequest, TradesRequest } from '@shared/ipc'
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

/** 0x054b 服务端排序的一页分类行情；category=6 是沪深 A 股。 */
export async function fetchCategoryQuotes(request: CategoryRequest): Promise<CategoryQuote[]> {
  return bridge.send<CategoryQuote[]>('category', { ...request }, QUOTES_TIMEOUT_MS)
}

/** 0x0fc5 / 0x0fc6 成交明细；date 省略走当日。 */
export async function fetchTrades(request: TradesRequest): Promise<TradeTick[]> {
  return bridge.send<TradeTick[]>('trades', { ...request }, QUOTES_TIMEOUT_MS)
}

/** 0x0ffc 资金流：最近 5 个交易日。 */
export async function fetchMoneyFlow(code: string): Promise<MoneyFlowRecord[]> {
  return bridge.send<MoneyFlowRecord[]>('money_flow', { code }, QUOTES_TIMEOUT_MS)
}

/** 0x056a 集合竞价过程；date 省略为当日。 */
export async function fetchAuctions(code: string, date?: string): Promise<AuctionPoint[]> {
  return bridge.send<AuctionPoint[]>(
    'auctions',
    { code, date: date || undefined, limit: 500 },
    QUOTES_TIMEOUT_MS
  )
}

/** 0x02cf F10 段落目录。 */
export async function fetchF10Catalog(code: string): Promise<F10Section[]> {
  return bridge.send<F10Section[]>('f10_catalog', { code }, QUOTES_TIMEOUT_MS)
}

/** 0x02d0 F10 段落正文。 */
export async function fetchF10Content(code: string, section: F10Section): Promise<string> {
  return bridge.send<string>(
    'f10_content',
    {
      code,
      filename: section.filename,
      start: section.start,
      length: section.length
    },
    QUOTES_TIMEOUT_MS
  )
}

/* ---------------------------------------------------------------- 数据工具 */

const DATA_TIMEOUT_MS = 180_000

/** 0x06b9 下载 zhb.zip 并解析 tdxstat 摘要。 */
export async function fetchTdxStatsSummary(): Promise<TdxStatsSummary> {
  return bridge.send<TdxStatsSummary>('tdx_stats', {}, DATA_TIMEOUT_MS)
}

/** 0x06b9 下载并写原始 ZIP + JSONL.gz + SQLite + manifest。 */
export async function fetchTdxStatsExport(): Promise<TdxStatsExport> {
  return bridge.send<TdxStatsExport>('tdx_stats_export', {}, DATA_TIMEOUT_MS)
}

/** stats.db 只读查询；SQL 只允许 SELECT/WITH。 */
export async function fetchStatsQuery(sql: string, limit = 200): Promise<StatsQueryResult> {
  return bridge.send<StatsQueryResult>('stats_query', { sql, limit }, 30_000)
}

export async function fetchStatsCsv(): Promise<StatsCsvExport> {
  return bridge.send<StatsCsvExport>('stats_csv', {}, 30_000)
}

const BLOCK_TIMEOUT_MS = 90_000

/** 0x06b9 下载 block_*.dat 并解析板块成分。 */
export async function fetchBlocks(kind: BlockKind): Promise<BlockList> {
  return bridge.send<BlockList>('blocks', { kind }, BLOCK_TIMEOUT_MS)
}

/** tdxhy.cfg + incon.dat 通达信行业分类。 */
export async function fetchIndustries(): Promise<IndustryList> {
  return bridge.send<IndustryList>('industries', {}, BLOCK_TIMEOUT_MS)
}

/** 全市场条件选股；后端按 60 秒缓存全市场分类行情。 */
export async function fetchScreen(request: ScreenRequest): Promise<ScreenResult> {
  return bridge.send<ScreenResult>('screen', { filters: request }, BLOCK_TIMEOUT_MS)
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
