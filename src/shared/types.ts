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

export type KLinePeriod = 'day' | 'week' | 'month'

export interface KLineBar {
  /** YYYY-MM-DD */
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
  /** 腾讯返回的证券类型，如 GP-A / ZS / JJ */
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
}

/** 持久化数据的当前版本 */
export const STATE_VERSION = 2

export const DEFAULT_GROUP_ID = 'default'

export const DEFAULT_SETTINGS: AppSettings = {
  refreshInterval: 3000,
  theme: 'dark',
  pauseWhenHidden: true,
  showSparkline: true
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

/** 默认分组（老用户从 v1 迁移过来时也落到这个分组） */
export const SEED_GROUPS: WatchGroup[] = [
  { id: DEFAULT_GROUP_ID, name: '自选', items: SEED_ITEMS },
  { id: 'tech', name: '科技', items: [] },
  { id: 'hk', name: '港股', items: [{ code: 'hk00700', name: '腾讯控股', market: 'HK' }] }
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
