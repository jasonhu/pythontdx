/**
 * IPC 通道契约。
 *
 * 主进程和 preload 都 import 这里的常量，避免「字符串写错但编译通过」这类低级事故。
 * 渲染层不直接接触通道名——它只使用 preload 暴露的 window.api。
 */
import type {
  AppInfo,
  GraphicsInfo,
  AppState,
  AuctionPoint,
  BlockKind,
  BlockList,
  CategoryQuote,
  F10Announcement,
  F10NewsItem,
  F10TradingTable,
  FormulaScreenRequest,
  FormulaScreenResult,
  FormulaMarketBacktestResult,
  F10ProfileTable,
  F10Section,
  IndustryList,
  KLineAdjust,
  KLinePeriod,
  KLineSeries,
  LocalDayBar,
  LocalDayResult,
  DataInventory,
  KLineCacheResult,
  KLineExportResult,
  SnapshotArchiveItem,
  SnapshotArchiveResult,
  LocalImportResult,
  LocalDayWriteResult,
  MacMoneyFlow,
  MacBoard,
  MacUnusualItem,
  MarketBreadth,
  MinuteTrend,
  MoneyFlowRecord,
  MultiDayTrend,
  Quote,
  QuoteUpdate,
  SearchItem,
  ScreenRequest,
  ScreenResult,
  StatsCsvExport,
  StatsParquetExport,
  StatsQueryResult,
  TdxStatsExport,
  TdxStatsSummary,
  TradeTick,
  WindowAction,
  WindowState
} from './types'
import type { SearchSecurity } from './search'

export const IPC = {
  /** 主动拉取一次快照（invoke） */
  quoteSnapshot: 'quote:snapshot',
  /** 订阅推送，并声明关心哪些代码（invoke） */
  quoteSubscribe: 'quote:subscribe',
  /** 取消订阅（invoke） */
  quoteUnsubscribe: 'quote:unsubscribe',
  /** 主进程 → 渲染进程的行情推送（on） */
  quoteUpdate: 'quote:update',
  /** 分类行情/排行榜（invoke） */
  quoteCategory: 'quote:category',
  /** 成交明细（invoke） */
  tradeTicks: 'trade:ticks',
  /** 资金流日数据（invoke） */
  moneyFlow: 'money:flow',
  /** MAC 0x1218 资金流（invoke） */
  moneyMac: 'money:mac',
  /** MAC 0x1237 异动（invoke） */
  macUnusual: 'mac:unusual',
  /** MAC 0x1231 板块列表（invoke） */
  macBoards: 'mac:boards',
  /** 集合竞价过程（invoke） */
  auctionSeries: 'auction:series',
  /** F10 段落目录（invoke） */
  f10Catalog: 'f10:catalog',
  /** F10 段落正文（invoke） */
  f10Content: 'f10:content',
  /** 7615 在线公告（invoke） */
  f10Announcements: 'f10:announcements',
  /** 7615 在线公司概况（invoke） */
  f10Profile: 'f10:profile',
  /** 7615 在线估值（invoke） */
  f10Valuation: 'f10:valuation',
  /** 7615 财务主要指标（invoke） */
  f10Finance: 'f10:finance',
  /** 7615 主营构成（invoke） */
  f10Business: 'f10:business',
  /** 7615 十大股东（invoke） */
  f10Shareholders: 'f10:shareholders',
  /** 7615 公司研报列表（invoke） */
  f10Reports: 'f10:reports',
  /** 7615 公司新闻（invoke） */
  f10News: 'f10:news',
  /** 7615 行业分析（invoke） */
  f10Industry: 'f10:industry',
  /** 7615 两融/大宗/龙虎榜/沪深股通（invoke） */
  f10Trading: 'f10:trading',
  /** 沪深龙虎榜（invoke） */
  f10LhbMarket: 'f10:lhb-market',
  /** 大盘资料（invoke） */
  f10Market: 'f10:market',
  /** 分红融资（invoke） */
  f10Dividend: 'f10:dividend',
  /** 股东人数历史（invoke） */
  f10ShareholderCount: 'f10:shareholder-count',
  /** 股本结构/变动/回购/限售（invoke） */
  f10Capital: 'f10:capital',
  /** 十大流通股东（invoke） */
  f10CirculatingShareholders: 'f10:circulating-shareholders',
  /** 股东增减持（invoke） */
  f10ShareholderChanges: 'f10:shareholder-changes',
  /** 机构持仓（invoke） */
  f10Institutions: 'f10:institutions',
  /** 控股股东/实际控制人（invoke） */
  f10Controller: 'f10:controller',
  /** 股东增减持计划（invoke） */
  f10ChangePlans: 'f10:change-plans',
  /** 全 A 股涨跌家数（invoke） */
  marketBreadth: 'market:breadth',
  /** 读取本地 .day 日线（invoke） */
  localDayRead: 'local:day',
  /** 本地行情导入数据湖（invoke） */
  localImport: 'local:import',
  /** 查询 local_bars.db（invoke） */
  localQuery: 'local:query',
  /** 写本地 .day（invoke） */
  localDayWrite: 'local:write',
  /** 批量导出 K 线（invoke） */
  exportKlines: 'data:export-klines',
  /** 预热自选 K 线本地缓存（invoke） */
  cacheKlines: 'data:cache-klines',
  /** 离线数据目录清单（invoke） */
  dataInventory: 'data:inventory',
  /** 全市场快照归档到数据湖（invoke） */
  archiveSnapshot: 'data:archive-snapshot',
  /** 数据湖归档列表（invoke） */
  lakeArchives: 'data:lake-archives',
  /** 写本地分钟文件（invoke） */
  localMinWrite: 'local:write-min',
  /** 7615 财务报表关键科目（invoke） */
  f10Statement: 'f10:statement',
  /** tdxstat 摘要（invoke） */
  dataStatsSummary: 'data:stats-summary',
  /** tdxstat 规范化导出（invoke） */
  dataStatsExport: 'data:stats-export',
  /** stats.db 只读查询（invoke） */
  dataStatsQuery: 'data:stats-query',
  /** stats.db 导出 CSV（invoke） */
  dataStatsCsv: 'data:stats-csv',
  /** stats.db 导出 Parquet（invoke） */
  dataStatsParquet: 'data:stats-parquet',
  /** stats Parquet DuckDB 只读查询（invoke） */
  dataDuckQuery: 'data:duck-query',
  /** 板块列表/成分（invoke） */
  blockList: 'block:list',
  /** 行业分类/成分（invoke） */
  blockIndustries: 'block:industries',
  /** 全市场条件选股（invoke） */
  screenRun: 'screen:run',
  /** 公式选股（invoke） */
  screenFormula: 'screen:formula',
  /** 全市场/前 N 公式组合回测（invoke） */
  screenFormulaBacktest: 'screen:formula_backtest',

  /** 当日分时（invoke） */
  trendMinute: 'trend:minute',
  /** 五日分时（invoke） */
  trendFiveDay: 'trend:five-day',
  /** K 线（invoke） */
  trendKline: 'trend:kline',

  /** 股票联想搜索（invoke） */
  searchHint: 'search:hint',
  /** 全量证券代码表（invoke） */
  quoteCatalog: 'quote:catalog',
  /** 显式 MAC 批量报价（invoke） */
  quoteMac: 'quote:mac',

  /** 读取持久化状态（invoke） */
  stateGet: 'state:get',
  /** 增量写入持久化状态（invoke） */
  statePatch: 'state:patch',

  /** 窗口控制（invoke） */
  windowControl: 'window:control',
  /** 打开独立 K 线窗口（invoke） */
  windowChart: 'window:chart',
  /** 打开第二个主窗口（invoke） */
  windowSecondary: 'window:secondary',
  /** 当前窗口置顶切换（invoke，返回新状态） */
  windowAlwaysOnTop: 'window:always-on-top',
  /** 窗口状态变化（on） */
  windowState: 'window:state',

  /** 运行时版本信息（invoke） */
  appInfo: 'app:info',
  /** 用系统默认浏览器打开链接（invoke） */
  appOpenExternal: 'app:open-external',
  /** 系统通知（invoke） */
  appNotify: 'app:notify',
  /** 图形后端诊断（invoke） */
  appGraphics: 'app:graphics'
} as const

export interface KLineRequest {
  code: string
  period: KLinePeriod
  /** 取多少根 K 线 */
  count?: number
  /** 复权口径；默认前复权 */
  adjust?: KLineAdjust
  /** 只读本地缓存；启动首屏用，不访问行情服务器 */
  cacheOnly?: boolean
}

/** 0x054b 分类行情请求；category=6 是沪深 A 股 */
export interface CategoryRequest {
  category?: number
  sortType?: number
  start?: number
  count?: number
  ascending?: boolean
  filterRaw?: number
}

/** 0x0fc5 / 0x0fc6 成交明细请求；date 省略时走当日 */
export interface TradesRequest {
  code: string
  start?: number
  count?: number
  /** YYYY-MM-DD 或 YYYYMMDD */
  date?: string
}

/**
 * preload 通过 contextBridge 暴露给渲染进程的完整 API。
 * 渲染进程的 window.api 就是这个类型（见 src/preload/index.d.ts）。
 */
export interface StockLensApi {
  quote: {
    /** 一次性拉取给定代码的行情快照 */
    snapshot(codes: string[]): Promise<Quote[]>
    /** 订阅推送；重复调用会覆盖上一次的订阅集合 */
    subscribe(codes: string[], intervalMs: number): Promise<void>
    unsubscribe(): Promise<void>
    /** 监听主进程推送，返回取消监听的函数 */
    onUpdate(listener: (update: QuoteUpdate) => void): () => void
    /** 服务端排序的一页分类行情（排行榜） */
    category(req: CategoryRequest): Promise<CategoryQuote[]>
    catalog(): Promise<SearchSecurity[]>
    macQuotes(codes: string[]): Promise<Quote[]>
  }
  trade: {
    /** 成交明细：不传 date 走当日 0x0fc5，传 date 走历史 0x0fc6 */
    ticks(req: TradesRequest): Promise<TradeTick[]>
  }
  money: {
    /** 最近 5 日资金流（0x0ffc） */
    flow(code: string): Promise<MoneyFlowRecord[]>
    macFlow(code: string): Promise<MacMoneyFlow>
  }
  mac: {
    /** 沪深异动（0x1237） */
    unusual(count?: number): Promise<MacUnusualItem[]>
    /** 板块列表（0x1231） */
    boards(boardType?: number): Promise<MacBoard[]>
  }
  auction: {
    /** 集合竞价过程快照（0x056a）；date 省略为当日 */
    series(code: string, date?: string): Promise<AuctionPoint[]>
  }
  market: {
    breadth(): Promise<MarketBreadth>
  }
  f10: {
    /** 公司资料目录（0x02cf） */
    catalog(code: string): Promise<F10Section[]>
    /** 公司资料正文（0x02d0） */
    content(code: string, section: F10Section): Promise<string>
    /** 7615 TQLEX 在线公告列表 */
    announcements(code: string): Promise<F10Announcement[]>
    profile(code: string): Promise<F10ProfileTable>
    valuation(code: string): Promise<F10ProfileTable>
    finance(code: string): Promise<F10ProfileTable>
    business(code: string): Promise<F10ProfileTable>
    shareholders(code: string): Promise<F10ProfileTable>
    reports(code: string): Promise<F10ProfileTable>
    news(code: string): Promise<F10NewsItem[]>
    industry(code: string, section: string): Promise<F10TradingTable>
    trading(code: string, section: string): Promise<F10TradingTable>
    lhbMarket(): Promise<F10TradingTable>
    market(section: string): Promise<F10TradingTable>
    dividend(code: string): Promise<F10ProfileTable>
    shareholderCount(code: string): Promise<F10ProfileTable>
    capital(code: string, section: string): Promise<F10TradingTable>
    circulatingShareholders(code: string): Promise<F10ProfileTable>
    shareholderChanges(code: string): Promise<F10ProfileTable>
    institutions(code: string): Promise<F10ProfileTable>
    controller(code: string): Promise<F10ProfileTable>
    changePlans(code: string): Promise<F10ProfileTable>
    statement(code: string, kind: string, full?: boolean): Promise<F10ProfileTable>
  }
  data: {
    /** 下载 zhb.zip 并返回 tdxstat 摘要 */
    statsSummary(): Promise<TdxStatsSummary>
    /** 下载并写原始 ZIP + JSONL.gz + SQLite + manifest */
    statsExport(): Promise<TdxStatsExport>
    /** 在 stats.db 上执行只读 SELECT/WITH */
    statsQuery(sql: string, limit?: number): Promise<StatsQueryResult>
    /** 把 tdxstat/tdxstat2 全量导出为 CSV */
    statsCsv(): Promise<StatsCsvExport>
    statsParquet(): Promise<StatsParquetExport>
    duckQuery(sql: string, limit?: number): Promise<StatsQueryResult>
    localDay(path: string, limit?: number): Promise<LocalDayResult>
    localImport(path: string): Promise<LocalImportResult>
    localQuery(sql: string, limit?: number): Promise<StatsQueryResult>
    localDayWrite(path: string, bars: LocalDayBar[]): Promise<LocalDayWriteResult>
    localMinWrite(path: string, bars: LocalDayBar[]): Promise<LocalDayWriteResult>
    exportKlines(req: {
      codes: string[]
      period?: string
      count?: number
      adjust?: string
    }): Promise<KLineExportResult>
    inventory(): Promise<DataInventory>
    cacheKlines(req: {
      codes: string[]
      period?: string
      count?: number
      adjust?: string
      skipExisting?: boolean
    }): Promise<KLineCacheResult>
    archiveSnapshot(): Promise<SnapshotArchiveResult>
    lakeArchives(limit?: number): Promise<SnapshotArchiveItem[]>
  }
  block: {
    /** 0x06b9 下载并解析 block_*.dat */
    list(kind: BlockKind): Promise<BlockList>
    /** tdxhy.cfg + incon.dat 行业分类 */
    industries(): Promise<IndustryList>
  }
  screen: {
    /** 全市场扫描；结果最多 200 条 */
    run(request: ScreenRequest): Promise<ScreenResult>
    formula(request: FormulaScreenRequest): Promise<FormulaScreenResult>
    formulaBacktest(request: FormulaScreenRequest): Promise<FormulaMarketBacktestResult>
  }
  trend: {
    minute(code: string): Promise<MinuteTrend>
    /** 五日分时 */
    fiveDay(code: string): Promise<MultiDayTrend>
    kline(req: KLineRequest): Promise<KLineSeries>
  }
  search: {
    hint(keyword: string): Promise<SearchItem[]>
  }
  state: {
    get(): Promise<AppState>
    patch(patch: Partial<AppState>): Promise<AppState>
  }
  window: {
    control(action: WindowAction): Promise<WindowState>
    openChart(code: string): Promise<void>
    openSecondary(): Promise<void>
    toggleAlwaysOnTop(): Promise<boolean>
    onStateChange(listener: (state: WindowState) => void): () => void
  }
  app: {
    info(): Promise<AppInfo>
    /** Linux 图形后端 / GPU 帧特性诊断 */
    graphics(): Promise<GraphicsInfo>
    /** 交给系统浏览器打开，避免在应用内弹出新窗口 */
    openExternal(url: string): Promise<void>
    /** 系统通知；不支持/未授权时静默失败 */
    notify(title: string, body: string): Promise<void>
  }
}
