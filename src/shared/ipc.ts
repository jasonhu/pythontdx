/**
 * IPC 通道契约。
 *
 * 主进程和 preload 都 import 这里的常量，避免「字符串写错但编译通过」这类低级事故。
 * 渲染层不直接接触通道名——它只使用 preload 暴露的 window.api。
 */
import type {
  AppInfo,
  AppState,
  KLinePeriod,
  KLineSeries,
  MinuteTrend,
  Quote,
  QuoteUpdate,
  SearchItem,
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

  /** 当日分时（invoke） */
  trendMinute: 'trend:minute',
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
  appOpenExternal: 'app:open-external'
} as const

export interface KLineRequest {
  code: string
  period: KLinePeriod
  /** 取多少根 K 线 */
  count?: number
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
  }
  trend: {
    minute(code: string): Promise<MinuteTrend>
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
  }
}
