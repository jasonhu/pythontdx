/**
 * IPC 注册中心。
 *
 * 约定：
 *  - 所有 invoke 处理器集中在这里注册，主进程其它模块只管业务，不碰 ipcMain；
 *  - 处理器内部不吞异常：抛出后 Electron 会把它序列化回渲染层，
 *    渲染层由 lib/ipc.ts 的 safeInvoke 统一转成可读的中文提示。
 */
import { ipcMain, app, shell, type BrowserWindow } from 'electron'
import type { AppState, F10Section } from '@shared/types'
import { IPC, type CategoryRequest, type KLineRequest, type TradesRequest } from '@shared/ipc'
import type { AppStore } from './services/store'
import type { QuotePoller } from './services/poller'
import {
  fetchAuctions,
  fetchCategoryQuotes,
  fetchF10Catalog,
  fetchF10Content,
  fetchFiveDayTrend,
  fetchKline,
  fetchMinuteTrend,
  fetchMoneyFlow,
  fetchQuotes,
  fetchSearchHint,
  fetchTdxStatsExport,
  fetchTdxStatsSummary,
  fetchTrades
} from './services/tdx'

export interface IpcContext {
  store: AppStore
  poller: QuotePoller
  getWindow: () => BrowserWindow | null
}

export function registerIpcHandlers(context: IpcContext): void {
  const { store, poller, getWindow } = context

  /* ---------------------------------------------------------- 行情 */

  ipcMain.handle(IPC.quoteSnapshot, (_event, codes: string[]) => fetchQuotes(codes))

  ipcMain.handle(IPC.quoteCategory, (_event, request: CategoryRequest) =>
    fetchCategoryQuotes(request)
  )

  ipcMain.handle(IPC.tradeTicks, (_event, request: TradesRequest) => fetchTrades(request))

  ipcMain.handle(IPC.moneyFlow, (_event, code: string) => fetchMoneyFlow(code))

  ipcMain.handle(IPC.auctionSeries, (_event, code: string, date?: string) =>
    fetchAuctions(code, date)
  )

  ipcMain.handle(IPC.f10Catalog, (_event, code: string) => fetchF10Catalog(code))

  ipcMain.handle(IPC.f10Content, (_event, code: string, section: F10Section) =>
    fetchF10Content(code, section)
  )

  ipcMain.handle(IPC.dataStatsSummary, () => fetchTdxStatsSummary())

  ipcMain.handle(IPC.dataStatsExport, () => fetchTdxStatsExport())

  ipcMain.handle(IPC.quoteSubscribe, (_event, codes: string[], intervalMs: number) => {
    poller.setSubscription(codes, intervalMs)
  })

  ipcMain.handle(IPC.quoteUnsubscribe, () => {
    poller.setSubscription([], 3000)
  })

  /* ---------------------------------------------------- 分时 / K 线 */

  ipcMain.handle(IPC.trendMinute, (_event, code: string) => fetchMinuteTrend(code))

  ipcMain.handle(IPC.trendFiveDay, (_event, code: string) => fetchFiveDayTrend(code))

  ipcMain.handle(IPC.trendKline, (_event, request: KLineRequest) =>
    fetchKline(request.code, request.period, request.count ?? 200)
  )

  /* ---------------------------------------------------------- 搜索 */

  ipcMain.handle(IPC.searchHint, (_event, keyword: string) => fetchSearchHint(keyword))

  /* ------------------------------------------------------ 持久化 */

  ipcMain.handle(IPC.stateGet, () => store.state)

  ipcMain.handle(IPC.statePatch, (_event, patch: Partial<AppState>) => {
    const next = store.patchState(patch)
    // 刷新间隔变了要立刻让轮询器跟上
    if (patch.settings?.refreshInterval !== undefined) {
      poller.setSubscription(
        next.groups.flatMap((group) => group.items.map((item) => item.code)),
        next.settings.refreshInterval
      )
    }
    return next
  })

  /* -------------------------------------------------------- 窗口 */

  ipcMain.handle(IPC.windowControl, (_event, action: string) => {
    const window = getWindow()
    if (!window) return { maximized: false, focused: false, platform: process.platform }

    switch (action) {
      case 'minimize':
        window.minimize()
        break
      case 'toggle-maximize':
        if (window.isMaximized()) window.unmaximize()
        else window.maximize()
        break
      case 'close':
        window.close()
        break
      case 'toggle-devtools':
        window.webContents.toggleDevTools()
        break
      default:
        break
    }

    return {
      maximized: window.isMaximized(),
      focused: window.isFocused(),
      platform: process.platform
    }
  })

  /* -------------------------------------------------------- 其它 */

  ipcMain.handle(IPC.appInfo, () => ({
    name: app.getName(),
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform
  }))

  ipcMain.handle(IPC.appOpenExternal, (_event, url: string) => {
    // 只允许 http/https，避免被注入 file:// 之类的协议
    if (/^https?:\/\//i.test(url)) return shell.openExternal(url)
    return undefined
  })
}
