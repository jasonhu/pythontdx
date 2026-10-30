/**
 * IPC 通道契约。
 *
 * 主进程和 preload 都 import 这里的常量，避免「字符串写错但编译通过」这类低级事故。
 * 渲染层不直接接触通道名——它只使用 preload 暴露的 window.api。
 */
import type {
  AppInfo,
  AppState,
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
  QuoteUpdate,
  SearchItem,
  TdxStatsExport,
  TdxStatsSummary,
  TradeTick,
  WindowAction,
  WindowState
} from './types'

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
  /** 集合竞价过程（invoke） */
  auctionSeries: 'auction:series',
  /** F10 段落目录（invoke） */
  f10Catalog: 'f10:catalog',
  /** F10 段落正文（invoke） */
  f10Content: 'f10:content',
  /** tdxstat 摘要（invoke） */
  dataStatsSummary: 'data:stats-summary',
  /** tdxstat 规范化导出（invoke） */
  dataStatsExport: 'data:stats-export',
  /** 板块列表/成分（invoke） */
  blockList: 'block:list',
  /** 行业分类/成分（invoke） */
  blockIndustries: 'block:industries',

  /** 当日分时（invoke） */
  trendMinute: 'trend:minute',
  /** 五日分时（invoke） */
  trendFiveDay: 'trend:five-day',
  /** K 线（invoke） */
  trendKline: 'trend:kline',

  /** 股票联想搜索（invoke） */
  searchHint: 'search:hint',

  /** 读取持久化状态（invoke） */
  stateGet: 'state:get',
  /** 增量写入持久化状态（invoke） */
  statePatch: 'state:patch',

  /** 窗口控制（invoke） */
  windowControl: 'window:control',
  /** 窗口状态变化（on） */
  windowState: 'window:state',

  /** 运行时版本信息（invoke） */
  appInfo: 'app:info',
  /** 用系统默认浏览器打开链接（invoke） */
  appOpenExternal: 'app:open-external',
  /** 系统通知（invoke） */
  appNotify: 'app:notify'
} as const

export interface KLineRequest {
  code: string
  period: KLinePeriod
  /** 取多少根 K 线 */
  count?: number
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
  }
  trade: {
    /** 成交明细：不传 date 走当日 0x0fc5，传 date 走历史 0x0fc6 */
    ticks(req: TradesRequest): Promise<TradeTick[]>
  }
  money: {
    /** 最近 5 日资金流（0x0ffc） */
    flow(code: string): Promise<MoneyFlowRecord[]>
  }
  auction: {
    /** 集合竞价过程快照（0x056a）；date 省略为当日 */
    series(code: string, date?: string): Promise<AuctionPoint[]>
  }
  f10: {
    /** 公司资料目录（0x02cf） */
    catalog(code: string): Promise<F10Section[]>
    /** 公司资料正文（0x02d0） */
    content(code: string, section: F10Section): Promise<string>
  }
  data: {
    /** 下载 zhb.zip 并返回 tdxstat 摘要 */
    statsSummary(): Promise<TdxStatsSummary>
    /** 下载并写原始 ZIP + JSONL.gz + SQLite + manifest */
    statsExport(): Promise<TdxStatsExport>
  }
  block: {
    /** 0x06b9 下载并解析 block_*.dat */
    list(kind: BlockKind): Promise<BlockList>
    /** tdxhy.cfg + incon.dat 行业分类 */
    industries(): Promise<IndustryList>
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
    onStateChange(listener: (state: WindowState) => void): () => void
  }
  app: {
    info(): Promise<AppInfo>
    /** 交给系统浏览器打开，避免在应用内弹出新窗口 */
    openExternal(url: string): Promise<void>
    /** 系统通知；不支持/未授权时静默失败 */
    notify(title: string, body: string): Promise<void>
  }
}
