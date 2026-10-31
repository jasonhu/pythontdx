/**
 * 主进程 / preload / 渲染进程 三方共享的数据契约。
 *
 * 设计原则：
 *  1. 这个文件只能有「类型」和「常量」，不能 import 任何 Electron / Node / DOM API，
 *     因为它同时被 tsconfig.node.json 和 tsconfig.web.json 编译。
 *  2. 所有跨进程传输的数据都必须是「可结构化克隆」的纯数据（无类实例、无函数、无 Map/Set）。
 */

/* ------------------------------------------------------------------ 市场 */

/** 支持的交易市场 */
export type Market = 'SH' | 'SZ' | 'BJ' | 'HK' | 'US' | 'UNKNOWN'

export const MARKET_LABEL: Record<Market, string> = {
  SH: '沪',
  SZ: '深',
  BJ: '京',
  HK: '港',
  US: '美',
  UNKNOWN: '—'
}

/* ------------------------------------------------------------------ 行情 */

/** 盘口一档（价格 + 挂单量，A 股单位为「手」） */
export interface OrderLevel {
  price: number
  volume: number
}

/** 单只股票的实时快照 */
export interface Quote {
  /** 带市场前缀的标准代码，如 sh600519 / hk00700 */
  code: string
  /** 不带前缀的交易代码，如 600519 */
  symbol: string
  name: string
  market: Market

  /** 最新价 */
  price: number
  /** 昨收 */
  prevClose: number
  /** 今开 */
  open: number
  /** 最高 */
  high: number
  /** 最低 */
  low: number
  /** 涨跌额 */
  change: number
  /** 涨跌幅（%） */
  changePct: number

  /** 成交量：A 股为「手」，港股为「股」 */
  volume: number
  /** 成交额：统一换算为「元」 */
  amount: number

  /** 换手率（%） */
  turnoverRate?: number
  /** 市盈率 TTM */
  peTtm?: number
  /** 市盈率（动态） */
  peDynamic?: number
  /** 市盈率（静态） */
  peStatic?: number
  /** 市净率 */
  pb?: number
  /** 振幅（%） */
  amplitude?: number
  /** 涨速（%） */
  riseSpeed?: number
  /** 量比 */
  volumeRatio?: number
  /** 均价 */
  avgPrice?: number
  /** 涨停价 */
  limitUp?: number
  /** 跌停价 */
  limitDown?: number
  /** 流通市值（亿元） */
  floatCap?: number
  /** 总市值（亿元） */
  totalCap?: number
  /** 币种，如 CNY / HKD */
  currency: string

  /** 交易所行情时间（epoch ms） */
  time: number
  /** 买一 ~ 买五 */
  bids: OrderLevel[]
  /** 卖一 ~ 卖五 */
  asks: OrderLevel[]

  /** 本地接收时间（epoch ms），用于展示数据新鲜度 */
  receivedAt: number
}

/** 0x054b 分类行情额外字段；榜单页使用，普通行情不保证存在 */
export interface CategoryQuote extends Quote {
  riseSpeed?: number
  shortTurnover?: number
  lockedAmount?: number
  openingRush?: number
  volRiseSpeed?: number
  depth?: number
  active2?: number
}

export type ScreenSortBy = 'changePct' | 'amount' | 'turnoverRate' | 'amplitude'

/** 全市场条件选股；金额单位统一为元 */
export interface ScreenRequest {
  minPrice?: number
  maxPrice?: number
  minChangePct?: number
  maxChangePct?: number
  minAmount?: number
  maxAmount?: number
  minTurnoverRate?: number
  maxTurnoverRate?: number
  minAmplitude?: number
  maxAmplitude?: number
  /** 通达信行业名；空/未传表示全市场 */
  industry?: string
  sortBy?: ScreenSortBy
  ascending?: boolean
  limit?: number
}

export interface FormulaQuote extends CategoryQuote {
  formulaValue: number
}

export interface FormulaScreenRequest {
  expression: string
  /** 按成交额取前 N；0 表示全市场 */
  scope?: number
  limit?: number
  /** 分块扫描起点 */
  offset?: number
  /** 每块扫描数量 */
  batchSize?: number
}

export interface FormulaMarketDay {
  date: string
  sum: number
  count: number
}

export interface FormulaMarketBacktestResult {
  scanned: number
  total: number
  nextOffset: number
  done: boolean
  trades: number
  stocks: number
  daily: FormulaMarketDay[]
  expression: string
  generatedAt: number
}

export interface FormulaScreenResult {
  scanned: number
  total: number
  nextOffset: number
  done: boolean
  matched: number
  quotes: FormulaQuote[]
  expression: string
  generatedAt: number
}

export interface ScreenResult {
  scanned: number
  matched: number
  quotes: CategoryQuote[]
  sortBy: ScreenSortBy
  generatedAt: number
}

/** 0x0fc5 / 0x0fc6 成交明细 */
export type TradeSide = 'buy' | 'sell' | 'neutral' | `status_${number}`
export type TradeEventKind = 'trade' | 'opening_match' | 'auction_snapshot'

export interface TradeTick {
  /** 服务端分页内的绝对序号 */
  index: number
  timeMinutes: number
  /** HH:MM */
  time: string
  price: number
  /** 手 */
  volume: number
  orderCount: number
  /** 0 买 / 1 卖 / 2 中性 / 5 盘后 / 8 竞价快照 */
  status: number
  side: TradeSide
  eventKind: TradeEventKind
  tailRaw?: number
  /** 只对非竞价快照计算；单位元 */
  tradeAmount?: number
}

/** 0x0ffc 资金流日记录；接口固定最近 5 个交易日 */
export interface MacBoard {
  market: number
  code: string
  name: string
  price: number
  riseSpeed: number
  preClose: number
  leaderMarket: number
  leaderCode: string
  leaderName: string
  leaderPrice: number
  leaderRiseSpeed: number
  leaderPreClose: number
  type: number
}

export interface MacUnusualItem {
  market: Market
  code: string
  symbol: string
  name: string
  time: string
  desc: string
  value: string
  type: number
  index: number
}

export interface MacMoneyFlow {
  mainIn: number
  mainOut: number
  mainNet: number
  retailIn: number
  retailOut: number
  retailNet: number
  largeNet5d: number
  midNet5d: number
  receivedAt: number
}

export interface MoneyFlowRecord {
  code: string
  market: Market
  symbol: string
  date: string
  totalAmount: number
  buckets: number[]
  mainNet: number
  mainRatio: number
  mainBuyNet: number
  mainBuyRatio: number
  mainSuperLargeNet: number
  mainLargeNet: number
  mainMediumNet: number
  mainSmallNet: number
  mainBuySuperLargeNet: number
  mainBuyLargeNet: number
  mainBuyMediumNet: number
  mainBuySmallNet: number
}

/** 0x056a 集合竞价过程快照 */
export interface AuctionPoint {
  index: number
  timeMinutes: number
  second: number
  /** HH:MM:SS */
  time: string
  timeSeconds: number
  price: number
  priceMilli: number
  /** 虚拟匹配量，单位手；不是真实成交 */
  matchedVolume: number
  unmatchedVolume: number
  /** 1 买方剩余 / -1 卖方剩余 */
  unmatchedDirection: number
}

/** 0x02cf F10 段落目录 */
export interface F10Section {
  name: string
  filename: string
  start: number
  length: number
}

export interface F10ProfileTable {
  columns: string[]
  rows: Array<Array<string | number | null>>
  reportDate?: string
  template?: number
  kind?: string
  full?: boolean
}

export interface LocalDayBar {
  date: string
  open: number
  high: number
  low: number
  close: number
  amount: number
  volume: number
}

export interface LocalDayWriteResult {
  path: string
  count: number
}

export interface SnapshotArchiveItem {
  dir: string
  tradeDate: string
  rows: number
  sha256: string
  generatedAt: string
  size: number
}

export interface SnapshotArchiveResult {
  dir: string
  rows: number
  sha256: string
  generatedAt: string
  tradeDate: string
}

export interface KLineExportResult {
  dir: string
  files: string[]
  rows: number
  codes: number
  generatedAt: string
  failed: Array<{ code: string; error: string }>
}

export interface LocalImportResult {
  code: string
  rows: number
  totalRows: number
  sha256: string
  rawPath: string
  jsonlPath: string
  database: string
  manifest: string
}

export interface LocalDayResult {
  path: string
  count: number
  firstDate: string
  lastDate: string
  bars: LocalDayBar[]
}

export interface MarketBreadth {
  up: number
  down: number
  flat: number
  limitUp?: number
  limitDown?: number
  total: number
  updatedAt: number
}

export interface F10TradingTable {
  section: string
  rawColumns: string[]
  columns: string[]
  rows: Array<Array<string | number>>
  count: number
}

export interface F10NewsItem {
  id: string
  date: string
  title: string
  source: string
}

export interface F10Announcement {
  id: string
  date: string
  title: string
  type: string
  source: string
  url: string
}

/* --------------------------------------------------------------- 数据工具 */

export interface TdxStatSample {
  market: number | null
  code: string
  beta60: number | null
  peTtm: number | null
  statsDate: string
  freeFloatShares10k: number | null
  yearLimitUpDays: number | null
  limitUpStreakDays: number | null
}

export interface TdxStat2Sample {
  market: number | null
  code: string
  statsDate: string
  amount10k: number | null
  sealAmount10k: number | null
  openAmount10k: number | null
}

export interface TdxStatsSummary {
  zipBytes: number
  zipEntries: number
  statCount: number
  stat2Count: number
  statsDate: string | null
  statsDateTop: Array<[string, number]>
  statSamples: TdxStatSample[]
  stat2Samples: TdxStat2Sample[]
  chunks: number
  sha256: string
  savedTo: string
}

export interface TdxStatsPartition {
  tradeDate: string
  statCount: number
  stat2Count: number
  path: string
}

export interface TdxStatsExport {
  normalizedTo: string
  manifest: string
  database: string
  sha256: string
  generatedAt: string
  partitions: TdxStatsPartition[]
  statCount: number
  stat2Count: number
  statSkipped: number
  stat2Skipped: number
  chunks: number
  rawSavedTo: string
  rawBytes: number
}

export interface StatsQueryResult {
  columns: string[]
  rows: Array<Array<string | number | null>>
  rowCount: number
  limited: boolean
}

export interface StatsParquetExport {
  rowCount: number
  target: string
  manifest: string
  schemaVersion: number
  files: Array<{ table: string; tradeDate: string; rows: number; path: string }>
}

export interface StatsCsvExport {
  statCsv: string
  stat2Csv: string
  statCount: number
  stat2Count: number
}

/* --------------------------------------------------------------- 板块数据 */

export type BlockKind = 'gn' | 'fg' | 'zs' | 'general'

export interface BlockGroup {
  id: string
  name: string
  kind: BlockKind | 'industry'
  /** 文件里记录的股票数（含未解析的代码） */
  count: number
  /** 对应的 880xxx 板块指数（tdxzs.cfg），没有则为空 */
  indexCode?: string
  /** 已解析成带市场前缀的代码 */
  codes: string[]
  /** 代码 → 名称，来自 0x044d 代码表 */
  names: Record<string, string>
}

export interface BlockList {
  kind: BlockKind
  label: string
  file: string
  bytes: number
  chunks: number
  sha256: string
  savedTo: string
  blockCount: number
  codeCount: number
  blocks: BlockGroup[]
}

export interface IndustryList {
  kind: 'industry'
  label: string
  file: string
  bytes: number
  chunks: number
  sha256: string
  savedTo: string
  /** incon.dat 在 zhb.zip 内的原始保存路径 */
  inconFrom: string
  zhbChunks: number
  blockCount: number
  codeCount: number
  blocks: BlockGroup[]
}

/* --------------------------------------------------------------- 分时图 */

/** 分时的分钟点：价格为该分钟收盘价，avg 为当日累计均价 */
export interface MinutePoint {
  /** HHMM，如 0930 */
  time: string
  price: number
  avg: number
  /** 该分钟成交量（手） */
  volume: number
}

export interface MinuteTrend {
  code: string
  name: string
  /** 交易日 YYYYMMDD */
  date: string
  /** 昨收，分时图的基准线 */
  prevClose: number
  points: MinutePoint[]
}

/** 多日分时（五日分时图）：days 按时间从旧到新排列 */
export interface MultiDayTrend {
  code: string
  name: string
  days: MinuteTrend[]
}

/* ----------------------------------------------------------------- K 线 */

export type KLinePeriod =
  | '5s'
  | '15s'
  | '1m'
  | '5m'
  | '10m'
  | '15m'
  | '20m'
  | '30m'
  | '60m'
  | '2m'
  | '3m'
  | '4m'
  | '6m'
  | '8m'
  | '12m'
  | '18m'
  | '24m'
  | '36m'
  | '48m'
  | 'day'
  | 'week'
  | 'month'
  | '2d'
  | '3d'
  | '4d'
  | '6d'
  | '9d'
  | '12d'
  | '18d'
  | '24d'
  | '45d'
  | 'quarter'
  | 'year'
export type KLineAdjust = 'none' | 'qfq' | 'hfq'

export interface KLineBar {
  /** YYYY-MM-DD，分钟 K 为 YYYY-MM-DD HH:MM */
  date: string
  open: number
  close: number
  high: number
  low: number
  /** 成交量（手） */
  volume: number
}

export interface KLineSeries {
  code: string
  period: KLinePeriod
  bars: KLineBar[]
}

/* ----------------------------------------------------------------- 搜索 */

export interface SearchItem {
  /** 带市场前缀的标准代码 */
  code: string
  symbol: string
  name: string
  market: Market
  /** 证券类型，如 GP-A / ZS / JJ / ZQ */
  kind: string
}

/* ------------------------------------------------------------- 自选与配置 */

export type ThemeMode = 'dark' | 'light'

export interface WatchItem {
  code: string
  name: string
  market: Market
}

/** 自选股分组 */
export interface WatchGroup {
  id: string
  name: string
  items: WatchItem[]
}

export interface IndicatorParams {
  macdFast: number
  macdSlow: number
  macdSignal: number
  kdjPeriod: number
  kdjM1: number
  kdjM2: number
  rsiPeriod: number
  bollPeriod: number
  bollK: number
}

export interface PortfolioPosition {
  code: string
  shares: number
  cost: number
}

export interface ChartDrawing {
  id: string
  code: string
  period: KLinePeriod
  type: 'horizontal' | 'trend' | 'vertical' | 'text'
  price?: number
  startIndex?: number
  startPrice?: number
  endIndex?: number
  endPrice?: number
  text?: string
}

export interface AppSettings {
  /** 行情轮询间隔（ms） */
  refreshInterval: number
  theme: ThemeMode
  /** 是否随窗口失焦暂停刷新 */
  pauseWhenHidden: boolean
  /** 自选股行内是否显示迷你走势图 */
  showSparkline: boolean
  /**
   * K 线可见根数（缩放档位），下次打开还用它。
   * 可选：默认值与合法档位由图表层给（`KLINE_BARS_MAX` / `nearestZoomLevel()`），
   * 档位表属于图表几何，不该复制一份到 shared 来（复制就一定会漂移）。
   */
  klineZoom?: number
  /** 图表上次停留的周期 */
  chartTab?: 'minute' | 'five' | KLinePeriod
  /** 上次复权口径 */
  klineAdjust?: KLineAdjust
  /** 主图是否叠加 BOLL */
  showBoll?: boolean
  /** 指标面板参数 */
  indicatorParams?: IndicatorParams
  /** K 线副图 */
  subIndicator?: 'none' | 'macd' | 'kdj' | 'rsi'
  /** 价格坐标是否对数 */
  logScale?: boolean
  /** K 线画线（按 code/period 保存） */
  chartDrawings?: ChartDrawing[]
  /** 上次读取的本地 .day 路径 */
  localDayPath?: string
  /** 关闭窗口时隐藏到托盘 */
  closeToTray?: boolean
  /** 自选侧栏宽度（px） */
  sidebarWidth?: number
  /** 右侧盘口栏宽度（px） */
  railWidth?: number
  /** 自定义版面槽（最多 3 个） */
  layoutSlots?: LayoutSlot[]
  /** 条件选股预设（最多 10 个） */
  screenPresets?: ScreenPreset[]
  /** 主图叠加公式；为空则关闭 */
  mainFormula?: string
  /** 正在自动跟踪的预设 id；为空则不跟踪 */
  trackingPresetId?: string
  /** 可同时跟踪多个预设 */
  trackingPresetIds?: string[]
}

export interface ScreenPreset {
  id: string
  name: string
  minChange: string
  minAmountYi: string
  minTurnover: string
  minAmplitude: string
  maxPrice: string
  industry: string
  sortBy: ScreenSortBy
  createdAt: number
}

export interface LayoutSlot {
  sidebar: number
  rail: number
  savedAt: number
}

export type AlertMetric = 'price' | 'changePct' | 'volumeRatio' | 'turnoverRate' | 'amplitude'
export type AlertDirection = 'above' | 'below'

export interface AlertCondition {
  metric: AlertMetric
  direction: AlertDirection
  value: number
}

export interface AlertRule {
  id: string
  code: string
  name: string
  metric: AlertMetric
  direction: AlertDirection
  value: number
  /** 可选：全部条件同时满足才触发；为空时使用顶层 metric/direction/value */
  conditions?: AlertCondition[]
  /** 组合条件关系：默认且 */
  conditionMode?: 'and' | 'or'
  enabled: boolean
  /** 最近一次触发的本地日期 YYYY-MM-DD；同一天不重复 */
  lastTriggeredDate?: string
}

export interface AlertEvent {
  rule: AlertRule
  quote: Quote
  at: number
  message: string
}

export interface SavedFormula {
  id: string
  name: string
  expression: string
  createdAt: number
}

export interface AppState {
  /** 数据结构版本，便于做迁移（v1 = 扁平 watchlist，v2 = 分组 groups） */
  version: number
  groups: WatchGroup[]
  /** 当前选中的分组 */
  activeGroupId: string
  settings: AppSettings
  /** 当前选中的股票代码 */
  activeCode: string | null
  /** 本地行情预警；不落交易指令 */
  alerts: AlertRule[]
  /** 本地保存的指标公式 */
  formulas: SavedFormula[]
  /** 最近 50 条预警触发记录（跨重启保留） */
  alertEvents?: AlertEvent[]
  /** 本地持仓（股数/成本） */
  positions?: PortfolioPosition[]
}

/** 持久化数据的当前版本 */
export const STATE_VERSION = 2

export const DEFAULT_GROUP_ID = 'default'

export const DEFAULT_SETTINGS: AppSettings = {
  closeToTray: true,
  refreshInterval: 3000,
  theme: 'dark',
  pauseWhenHidden: true,
  showSparkline: true,
  sidebarWidth: 264,
  railWidth: 318
}

/** 首次启动时的示例自选股，让界面一打开就是「满的」 */
const SEED_ITEMS: WatchItem[] = [
  { code: 'sh600519', name: '贵州茅台', market: 'SH' },
  { code: 'sz300750', name: '宁德时代', market: 'SZ' },
  { code: 'sz002594', name: '比亚迪', market: 'SZ' },
  { code: 'sh601318', name: '中国平安', market: 'SH' },
  { code: 'sz000858', name: '五粮液', market: 'SZ' },
  { code: 'sz300059', name: '东方财富', market: 'SZ' }
]

/**
 * 默认分组（老用户从 v1 迁移过来时也落到这个分组）。
 *
 * 港股分组已移除：通达信 7709 不提供港股行情，留着只会显示一行「—」。
 * 老用户的持久化数据不会被动删，港股自选会保留但暂时没有行情。
 */
export const SEED_GROUPS: WatchGroup[] = [
  { id: DEFAULT_GROUP_ID, name: '自选', items: SEED_ITEMS },
  { id: 'tech', name: '科技', items: [] }
]

/* --------------------------------------------------------------- 窗口/应用 */

export type WindowAction = 'minimize' | 'toggle-maximize' | 'close' | 'toggle-devtools'

export interface WindowState {
  maximized: boolean
  focused: boolean
  /** win32 / darwin / linux */
  platform: string
}

export interface AppInfo {
  name: string
  version: string
  electron: string
  chrome: string
  node: string
  platform: string
}

/** 主进程推送的一帧行情更新 */
export interface QuoteUpdate {
  /** 本次拉到的行情；失败时为空数组 */
  quotes: Quote[]
  /** 本地生成时间（epoch ms） */
  at: number
  /** 本次拉取失败时的原因（此时 quotes 为空，渲染层应保留上一帧数据） */
  error?: string
}

/* ------------------------------------------------------------------ 状态 */

/** 行情连接质量，用于状态栏指示灯 */
export type ConnectionStatus = 'idle' | 'connecting' | 'live' | 'error'
