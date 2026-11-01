/**
 * 通达信行情门面。
 *
 * 真正的 TCP/协议/解析在 Python 桥接进程里；这里只做：
 *   · 把渲染层的请求翻译成 JSON 命令；
 *   · 缓存 K 线/分时这类低频数据；
 *   · 维护代码表 + 拼音搜索索引。
 */
import type {
  AuctionArchiveBatchResult,
  AuctionArchiveItem,
  AuctionArchiveResult,
  AuctionPoint,
  BlockKind,
  BlockList,
  CategoryQuote,
  F10Announcement,
  F10NewsItem,
  MarketBreadth,
  LocalDayBar,
  LocalDayResult,
  DataBackupCreateResult,
  DataBackupInspectResult,
  DataBackupRestoreResult,
  DatasetArchiveResult,
  DataInventory,
  KLineCacheResult,
  FullKLineCacheResult,
  LimitReviewResult,
  KLineExportResult,
  SnapshotArchiveItem,
  SnapshotArchiveResult,
  TickArchiveBatchResult,
  TickArchiveItem,
  TickArchiveResult,
  LocalImportResult,
  LocalDayWriteResult,
  F10TradingTable,
  F10ProfileTable,
  FormulaScreenRequest,
  FormulaScreenResult,
  FormulaMarketBacktestResult,
  F10Section,
  IndustryList,
  KLineAdjust,
  KLinePeriod,
  KLineSeries,
  ServerSpeedResult,
  MinuteTrend,
  MacMoneyFlow,
  MacMoneyFlowPoint,
  MacBoard,
  MacUnusualItem,
  MoneyFlowRecord,
  MultiDayTrend,
  Quote,
  ScreenRequest,
  ScreenResult,
  SearchItem,
  StatsCsvExport,
  StatsParquetExport,
  StatsQueryResult,
  TdxStatsExport,
  TdxStatsSummary,
  TradeTick
} from '@shared/types'
import type { ChartPatternsRequest, ChartPatternsResult } from '@shared/patterns'
import type { CategoryRequest, TradesRequest } from '@shared/ipc'
import { splitCode } from '@shared/market'
import { TtlCache } from '../cache'
import { CODE_LIST_TIMEOUT_MS, QUOTES_TIMEOUT_MS, TdxBridge, TdxError } from './bridge'
import { buildSearchEntries, searchEntries, type SearchEntry, type SearchSecurity } from './search'
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
export async function fetchMacQuotes(codes: string[]): Promise<Quote[]> {
  return bridge.send<Quote[]>('mac_quotes', { codes: normalizeCodes(codes) }, 30_000)
}

/** 全市场市值排行：MAC 报价后补 0x0010 财务；财务失败仍返回行情。 */
export async function fetchMacQuotesFinance(codes: string[]): Promise<Quote[]> {
  return bridge.send<Quote[]>('mac_quotes_finance', { codes: normalizeCodes(codes) }, 90_000)
}

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
export async function fetchMacBoards(boardType = 255): Promise<MacBoard[]> {
  return bridge.send<MacBoard[]>('mac_boards', { boardType }, QUOTES_TIMEOUT_MS)
}

export async function fetchMacUnusual(count = 600): Promise<MacUnusualItem[]> {
  return bridge.send<MacUnusualItem[]>('mac_unusual', { count }, QUOTES_TIMEOUT_MS)
}

export async function fetchMacMoneyFlow(code: string): Promise<MacMoneyFlow> {
  return bridge.send<MacMoneyFlow>('mac_money_flow', { code }, QUOTES_TIMEOUT_MS)
}

/** 批量 0x1218；单只失败由 Python 侧跳过，不阻断整张榜。 */
export async function fetchMacMoneyFlowBatch(
  codes: string[],
  workers = 12
): Promise<MacMoneyFlowPoint[]> {
  return bridge.send<MacMoneyFlowPoint[]>(
    'mac_money_flow_batch',
    { codes: normalizeCodes(codes), workers },
    90_000
  )
}

export async function fetchAuctions(code: string, date?: string): Promise<AuctionPoint[]> {
  return bridge.send<AuctionPoint[]>(
    'auctions',
    { code, date: date || undefined, limit: 500 },
    QUOTES_TIMEOUT_MS
  )
}

export async function fetchAuctionArchiveSave(
  code: string,
  date?: string
): Promise<AuctionArchiveResult> {
  return bridge.send<AuctionArchiveResult>(
    'auction_archive_save',
    { code, date: date || undefined },
    QUOTES_TIMEOUT_MS
  )
}

export async function fetchAuctionArchiveRead(
  code: string,
  date: string
): Promise<AuctionArchiveResult> {
  return bridge.send<AuctionArchiveResult>(
    'auction_archive_read',
    { code, date },
    QUOTES_TIMEOUT_MS
  )
}

export async function fetchAuctionArchiveList(limit = 50): Promise<AuctionArchiveItem[]> {
  return bridge.send<AuctionArchiveItem[]>('auction_archive_list', { limit }, QUOTES_TIMEOUT_MS)
}

export async function fetchAuctionArchiveBatch(
  codes: string[],
  date?: string
): Promise<AuctionArchiveBatchResult> {
  return bridge.send<AuctionArchiveBatchResult>(
    'auction_archive_batch',
    { codes: normalizeCodes(codes), date: date || undefined },
    90_000
  )
}

/** 单只历史逐笔归档；整日数据可能多页，给足 5 分钟。 */
export async function saveTickArchive(code: string, date: string): Promise<TickArchiveResult> {
  return bridge.send<TickArchiveResult>('tick_archive_save', { code, date }, 300_000)
}

/** 批量逐笔归档；UI 已按只调用，保留批量给脚本/HTTP。 */
export async function fetchTickArchiveBatch(
  codes: string[],
  date: string
): Promise<TickArchiveBatchResult> {
  return bridge.send<TickArchiveBatchResult>(
    'tick_archive_batch',
    { codes: normalizeCodes(codes), date },
    600_000
  )
}

export async function fetchTickArchiveDates(
  code: string,
  start?: string,
  end?: string,
  days = 20
): Promise<string[]> {
  return bridge.send<string[]>(
    'tick_archive_dates',
    { code, start: start || undefined, end: end || undefined, days },
    120_000
  )
}

export async function fetchTickArchiveList(limit = 20): Promise<TickArchiveItem[]> {
  return bridge.send<TickArchiveItem[]>('tick_archive_list', { limit }, 20_000)
}

/** 0x02cf F10 段落目录。 */
export async function fetchF10Catalog(code: string): Promise<F10Section[]> {
  return bridge.send<F10Section[]>('f10_catalog', { code }, QUOTES_TIMEOUT_MS)
}

/** 0x02d0 F10 段落正文。 */
export async function fetchF10ChangePlans(code: string): Promise<F10ProfileTable> {
  return bridge.send<F10ProfileTable>('f10_change_plans', { code }, QUOTES_TIMEOUT_MS)
}

export async function fetchF10Controller(code: string): Promise<F10ProfileTable> {
  return bridge.send<F10ProfileTable>('f10_controller', { code }, QUOTES_TIMEOUT_MS)
}

export async function fetchF10Institutions(code: string): Promise<F10ProfileTable> {
  return bridge.send<F10ProfileTable>('f10_institutions', { code }, QUOTES_TIMEOUT_MS)
}

export async function fetchF10ShareholderChanges(code: string): Promise<F10ProfileTable> {
  return bridge.send<F10ProfileTable>('f10_shareholder_changes', { code }, QUOTES_TIMEOUT_MS)
}

export async function fetchF10CirculatingShareholders(code: string): Promise<F10ProfileTable> {
  return bridge.send<F10ProfileTable>('f10_circulating_shareholders', { code }, QUOTES_TIMEOUT_MS)
}

export async function fetchF10Capital(code: string, section: string): Promise<F10TradingTable> {
  return bridge.send<F10TradingTable>('f10_capital', { code, section }, QUOTES_TIMEOUT_MS)
}

export async function fetchF10ShareholderCount(code: string): Promise<F10ProfileTable> {
  return bridge.send<F10ProfileTable>('f10_shareholder_count', { code }, QUOTES_TIMEOUT_MS)
}

export async function fetchF10Dividend(code: string): Promise<F10ProfileTable> {
  return bridge.send<F10ProfileTable>('f10_dividend', { code }, QUOTES_TIMEOUT_MS)
}

export async function fetchF10Market(section: string): Promise<F10TradingTable> {
  return bridge.send<F10TradingTable>('f10_market', { section }, 20_000)
}

export async function fetchF10LhbMarket(): Promise<F10TradingTable> {
  return bridge.send<F10TradingTable>('f10_lhb_market', {}, 20_000)
}

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

/** 7615 TQLEX 在线公告（免费，不拉研报正文）。 */
export async function fetchF10Announcements(code: string): Promise<F10Announcement[]> {
  return bridge.send<F10Announcement[]>('f10_announcements', { code }, 20_000)
}

export async function fetchF10Profile(code: string): Promise<F10ProfileTable> {
  return bridge.send<F10ProfileTable>('f10_profile', { code }, 20_000)
}

export async function fetchF10Valuation(code: string): Promise<F10ProfileTable> {
  return bridge.send<F10ProfileTable>('f10_valuation', { code }, 20_000)
}

export async function fetchF10Finance(code: string): Promise<F10ProfileTable> {
  return bridge.send<F10ProfileTable>('f10_finance', { code }, 20_000)
}

export async function fetchF10Business(code: string): Promise<F10ProfileTable> {
  return bridge.send<F10ProfileTable>('f10_business', { code }, 20_000)
}

export async function fetchF10Shareholders(code: string): Promise<F10ProfileTable> {
  return bridge.send<F10ProfileTable>('f10_shareholders', { code }, 20_000)
}

export async function fetchF10Reports(code: string): Promise<F10ProfileTable> {
  return bridge.send<F10ProfileTable>('f10_reports', { code }, 20_000)
}

export async function fetchF10News(code: string): Promise<F10NewsItem[]> {
  return bridge.send<F10NewsItem[]>('f10_news', { code }, 20_000)
}

export async function fetchF10Industry(code: string, section: string): Promise<F10TradingTable> {
  return bridge.send<F10TradingTable>('f10_industry', { code, section }, 20_000)
}

export async function fetchF10Trading(code: string, section: string): Promise<F10TradingTable> {
  return bridge.send<F10TradingTable>('f10_trading', { code, section }, 20_000)
}

export async function fetchF10Statement(
  code: string,
  kind: string,
  full = false
): Promise<F10ProfileTable> {
  return bridge.send<F10ProfileTable>('f10_statement', { code, kind, full }, 20_000)
}

/* ---------------------------------------------------------------- 数据工具 */

export async function fetchMarketBreadth(): Promise<MarketBreadth> {
  return bridge.send<MarketBreadth>('market_breadth', {}, 30_000)
}

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

export async function fetchStatsParquet(): Promise<StatsParquetExport> {
  return bridge.send<StatsParquetExport>('stats_parquet', {}, 120_000)
}

export async function fetchDuckQuery(sql: string, limit = 200): Promise<StatsQueryResult> {
  return bridge.send<StatsQueryResult>('stats_duck_query', { sql, limit }, 30_000)
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

export async function fetchFormulaScreen(
  request: FormulaScreenRequest
): Promise<FormulaScreenResult> {
  return bridge.send<FormulaScreenResult>(
    'formula_screen',
    {
      expression: request.expression,
      scope: request.scope,
      limit: request.limit,
      offset: request.offset,
      batchSize: request.batchSize
    },
    180_000
  )
}

export async function fetchLakeArchives(limit = 20): Promise<SnapshotArchiveItem[]> {
  return bridge.send<SnapshotArchiveItem[]>('lake_archives', { limit }, 20_000)
}

export async function archiveSnapshot(): Promise<SnapshotArchiveResult> {
  return bridge.send<SnapshotArchiveResult>('archive_snapshot', {}, 120_000)
}

export async function dataInventory(): Promise<DataInventory> {
  return bridge.send<DataInventory>('data_inventory', {}, 20_000)
}

/**
 * 备份整个离线数据目录。
 *
 * 超时给到 2 小时：用户的数据湖可能有几 GB，走的是真实磁盘写入 + NAS 路径，
 * 主进程不能按普通报表请求的 20 秒去掐断。
 */
export async function backupOfflineData(path: string): Promise<DataBackupCreateResult> {
  return bridge.send<DataBackupCreateResult>('backup_create', { path }, 2 * 60 * 60_000)
}

export async function inspectOfflineBackup(path: string): Promise<DataBackupInspectResult> {
  return bridge.send<DataBackupInspectResult>('backup_inspect', { path }, 120_000)
}

export async function restoreOfflineData(path: string): Promise<DataBackupRestoreResult> {
  return bridge.send<DataBackupRestoreResult>('backup_restore', { path }, 2 * 60 * 60_000)
}

/** 板块 / 财务 / 龙虎榜全量落盘；财务按传入代码逐只抓，耗时可能很长。 */
export async function archiveDatasets(codes: string[]): Promise<DatasetArchiveResult> {
  return bridge.send<DatasetArchiveResult>('archive_datasets', { codes }, 2 * 60 * 60_000)
}

export async function fetchChartPatterns(req: ChartPatternsRequest): Promise<ChartPatternsResult> {
  return bridge.send<ChartPatternsResult>('chart_patterns', { ...req }, 120_000)
}

export async function limitReview(date: string): Promise<LimitReviewResult> {
  return bridge.send<LimitReviewResult>('limit_review', { date }, 120_000)
}

export async function speedTestServers(): Promise<ServerSpeedResult> {
  return bridge.send<ServerSpeedResult>('server_speed_test', {}, 30_000)
}

export async function selectServer(host: string): Promise<{ preferred: string }> {
  return bridge.send<{ preferred: string }>('select_server', { host }, 20_000)
}

export async function cacheKlines(req: {
  codes: string[]
  period?: string
  count?: number
  adjust?: string
  skipExisting?: boolean
}): Promise<KLineCacheResult> {
  return bridge.send<KLineCacheResult>('cache_klines', req, 60_000)
}

export async function cacheFullKlines(req: {
  codes: string[]
  period?: string
  adjust?: string
  skipExisting?: boolean
}): Promise<FullKLineCacheResult> {
  // 全历史需要多次 800 根分页；给足 10 分钟，逐只失败会返回在 failed 里。
  return bridge.send<FullKLineCacheResult>('cache_full_klines', req, 600_000)
}

export async function exportKlines(req: {
  codes: string[]
  period?: string
  count?: number
  adjust?: string
}): Promise<KLineExportResult> {
  return bridge.send<KLineExportResult>('export_klines', req, 60_000)
}

export async function writeLocalDay(
  path: string,
  bars: LocalDayBar[]
): Promise<LocalDayWriteResult> {
  return bridge.send<LocalDayWriteResult>('local_day_write', { path, bars }, 20_000)
}

export async function writeLocalMin(
  path: string,
  bars: LocalDayBar[]
): Promise<LocalDayWriteResult> {
  return bridge.send<LocalDayWriteResult>('local_min_write', { path, bars }, 20_000)
}

export async function fetchLocalQuery(sql: string, limit = 200): Promise<StatsQueryResult> {
  return bridge.send<StatsQueryResult>('local_query', { sql, limit }, 20_000)
}

export async function fetchLocalImport(path: string): Promise<LocalImportResult> {
  return bridge.send<LocalImportResult>('local_import', { path }, 60_000)
}

export async function fetchLocalDay(path: string, limit = 0): Promise<LocalDayResult> {
  return bridge.send<LocalDayResult>('local_day_read', { path, limit }, 20_000)
}

export async function fetchFormulaBacktest(
  request: FormulaScreenRequest
): Promise<FormulaMarketBacktestResult> {
  return bridge.send<FormulaMarketBacktestResult>(
    'formula_backtest',
    {
      expression: request.expression,
      scope: request.scope,
      offset: request.offset,
      batchSize: request.batchSize
    },
    180_000
  )
}

/* ------------------------------------------------------------------ K 线 */

export async function fetchKline(
  code: string,
  period: KLinePeriod,
  count = 200,
  adjust: KLineAdjust = 'qfq',
  signal?: AbortSignal,
  cacheOnly = false
): Promise<KLineSeries> {
  assertSupported(code)
  if (signal?.aborted) throw new TdxError('请求已取消')

  const safeCount = Math.min(800, Math.max(1, Math.trunc(count)))
  if (cacheOnly) {
    return bridge.send<KLineSeries>(
      'kline',
      { code, period, count: safeCount, adjust, cacheOnly: true },
      QUOTES_TIMEOUT_MS
    )
  }
  const key = `${code}:${period}:${safeCount}:${adjust}`

  return klineCache.resolve(key, () =>
    bridge.send<KLineSeries>('kline', { code, period, count: safeCount, adjust })
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

export async function fetchSecurityCatalog(): Promise<SearchSecurity[]> {
  const index = await ensureCodeIndex()
  return index.entries.map((entry) => ({ ...entry.info }))
}

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
