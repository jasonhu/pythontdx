/**
 * IPC 注册中心。
 *
 * 约定：
 *  - 所有 invoke 处理器集中在这里注册，主进程其它模块只管业务，不碰 ipcMain；
 *  - 处理器内部不吞异常：抛出后 Electron 会把它序列化回渲染层，
 *    渲染层由 lib/ipc.ts 的 safeInvoke 统一转成可读的中文提示。
 */
import { ipcMain, app, shell, Notification, type BrowserWindow } from 'electron'
import type {
  AppState,
  BlockKind,
  F10Section,
  FormulaScreenRequest,
  ScreenRequest
} from '@shared/types'
import { IPC, type CategoryRequest, type KLineRequest, type TradesRequest } from '@shared/ipc'
import type { AppStore } from './services/store'
import { createChartWindow } from './window'
import type { QuotePoller } from './services/poller'
import {
  fetchAuctions,
  fetchBlocks,
  fetchCategoryQuotes,
  fetchDuckQuery,
  fetchF10Announcements,
  fetchF10Business,
  fetchF10News,
  fetchF10Trading,
  fetchMarketBreadth,
  fetchLocalDay,
  fetchLocalImport,
  fetchLocalQuery,
  fetchF10Reports,
  fetchF10Statement,
  fetchFormulaScreen,
  fetchFormulaBacktest,
  fetchF10Shareholders,
  fetchF10Catalog,
  fetchF10Profile,
  fetchF10Finance,
  fetchF10Valuation,
  fetchF10Content,
  fetchFiveDayTrend,
  fetchIndustries,
  fetchKline,
  fetchMinuteTrend,
  fetchMoneyFlow,
  fetchQuotes,
  fetchScreen,
  fetchSearchHint,
  fetchStatsCsv,
  fetchStatsParquet,
  fetchStatsQuery,
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

  ipcMain.handle(IPC.f10Announcements, (_event, code: string) => fetchF10Announcements(code))

  ipcMain.handle(IPC.f10Profile, (_event, code: string) => fetchF10Profile(code))

  ipcMain.handle(IPC.f10Valuation, (_event, code: string) => fetchF10Valuation(code))

  ipcMain.handle(IPC.f10Finance, (_event, code: string) => fetchF10Finance(code))

  ipcMain.handle(IPC.f10Business, (_event, code: string) => fetchF10Business(code))

  ipcMain.handle(IPC.f10Shareholders, (_event, code: string) => fetchF10Shareholders(code))

  ipcMain.handle(IPC.f10Reports, (_event, code: string) => fetchF10Reports(code))

  ipcMain.handle(IPC.f10News, (_event, code: string) => fetchF10News(code))

  ipcMain.handle(IPC.f10Trading, (_event, code: string, section: string) =>
    fetchF10Trading(code, section)
  )

  ipcMain.handle(IPC.marketBreadth, () => fetchMarketBreadth())

  ipcMain.handle(IPC.localDayRead, (_event, path: string, limit?: number) =>
    fetchLocalDay(path, limit)
  )

  ipcMain.handle(IPC.localImport, (_event, path: string) => fetchLocalImport(path))

  ipcMain.handle(IPC.localQuery, (_event, sql: string, limit?: number) =>
    fetchLocalQuery(sql, limit)
  )

  ipcMain.handle(IPC.f10Statement, (_event, code: string, kind: string, full?: boolean) =>
    fetchF10Statement(code, kind, full)
  )

  ipcMain.handle(IPC.dataStatsSummary, () => fetchTdxStatsSummary())

  ipcMain.handle(IPC.dataStatsExport, () => fetchTdxStatsExport())

  ipcMain.handle(IPC.dataStatsQuery, (_event, sql: string, limit?: number) =>
    fetchStatsQuery(sql, limit)
  )

  ipcMain.handle(IPC.dataStatsCsv, () => fetchStatsCsv())

  ipcMain.handle(IPC.dataStatsParquet, () => fetchStatsParquet())

  ipcMain.handle(IPC.dataDuckQuery, (_event, sql: string, limit?: number) =>
    fetchDuckQuery(sql, limit)
  )

  ipcMain.handle(IPC.blockList, (_event, kind: BlockKind) => fetchBlocks(kind))

  ipcMain.handle(IPC.blockIndustries, () => fetchIndustries())

  ipcMain.handle(IPC.screenRun, (_event, request: ScreenRequest) => fetchScreen(request))

  ipcMain.handle(IPC.screenFormula, (_event, request: FormulaScreenRequest) =>
    fetchFormulaScreen(request)
  )

  ipcMain.handle(IPC.screenFormulaBacktest, (_event, request: FormulaScreenRequest) =>
    fetchFormulaBacktest(request)
  )

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
    fetchKline(request.code, request.period, request.count ?? 200, request.adjust ?? 'qfq')
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

  ipcMain.handle(IPC.windowChart, (_event, code: string) => {
    createChartWindow(code)
  })

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

  ipcMain.handle(IPC.appNotify, (_event, title: string, body: string) => {
    try {
      if (Notification.isSupported()) {
        new Notification({ title: String(title), body: String(body) }).show()
      }
    } catch (error) {
      console.error('[notify] 系统通知失败：', error)
    }
  })
}
