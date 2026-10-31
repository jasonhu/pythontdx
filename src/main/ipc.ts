/**
 * IPC 注册中心。
 *
 * 约定：
 *  - 所有 invoke 处理器集中在这里注册，主进程其它模块只管业务，不碰 ipcMain；
 *  - 处理器内部不吞异常：抛出后 Electron 会把它序列化回渲染层，
 *    渲染层由 lib/ipc.ts 的 safeInvoke 统一转成可读的中文提示。
 */
import { ipcMain, app, shell, Notification, BrowserWindow } from 'electron'
import type {
  AppState,
  BlockKind,
  F10Section,
  LocalDayBar,
  FormulaScreenRequest,
  ScreenRequest
} from '@shared/types'
import { IPC, type CategoryRequest, type KLineRequest, type TradesRequest } from '@shared/ipc'
import type { AppStore } from './services/store'
import {
  createChartWindow,
  createSecondaryWindow,
  createServerWindow,
  listDisplays,
  moveWindowToDisplay
} from './window'
import type { QuotePoller } from './services/poller'
import {
  fetchAuctionArchiveBatch,
  fetchAuctionArchiveList,
  fetchAuctionArchiveRead,
  fetchAuctionArchiveSave,
  fetchAuctions,
  fetchBlocks,
  fetchCategoryQuotes,
  fetchMacQuotes,
  fetchDuckQuery,
  fetchF10Announcements,
  fetchF10Business,
  fetchF10News,
  fetchF10Industry,
  fetchF10Trading,
  fetchMarketBreadth,
  fetchLocalDay,
  fetchLocalImport,
  fetchLocalQuery,
  exportKlines,
  cacheKlines,
  cacheFullKlines,
  dataInventory,
  limitReview,
  speedTestServers,
  selectServer,
  archiveSnapshot,
  fetchLakeArchives,
  writeLocalDay,
  writeLocalMin,
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
  fetchF10LhbMarket,
  fetchF10Dividend,
  fetchF10ShareholderCount,
  fetchF10Capital,
  fetchF10CirculatingShareholders,
  fetchF10ShareholderChanges,
  fetchF10Institutions,
  fetchF10Controller,
  fetchF10ChangePlans,
  fetchF10Market,
  fetchFiveDayTrend,
  fetchIndustries,
  fetchKline,
  fetchMinuteTrend,
  fetchMacMoneyFlow,
  fetchMacMoneyFlowBatch,
  fetchMacBoards,
  fetchMacUnusual,
  fetchMoneyFlow,
  fetchQuotes,
  fetchScreen,
  fetchSearchHint,
  fetchSecurityCatalog,
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

  ipcMain.handle(IPC.moneyMac, (_event, code: string) => fetchMacMoneyFlow(code))

  ipcMain.handle(IPC.moneyMacBatch, (_event, codes: string[], workers?: number) =>
    fetchMacMoneyFlowBatch(codes, workers)
  )

  ipcMain.handle(IPC.macUnusual, (_event, count?: number) => fetchMacUnusual(count))

  ipcMain.handle(IPC.macBoards, (_event, boardType?: number) => fetchMacBoards(boardType))

  ipcMain.handle(IPC.auctionSeries, (_event, code: string, date?: string) =>
    fetchAuctions(code, date)
  )

  ipcMain.handle(IPC.auctionArchiveSave, (_event, code: string, date?: string) =>
    fetchAuctionArchiveSave(code, date)
  )

  ipcMain.handle(IPC.auctionArchiveRead, (_event, code: string, date: string) =>
    fetchAuctionArchiveRead(code, date)
  )

  ipcMain.handle(IPC.auctionArchiveList, (_event, limit?: number) => fetchAuctionArchiveList(limit))

  ipcMain.handle(IPC.auctionArchiveBatch, (_event, codes: string[], date?: string) =>
    fetchAuctionArchiveBatch(codes, date)
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

  ipcMain.handle(IPC.f10Industry, (_event, code: string, section: string) =>
    fetchF10Industry(code, section)
  )

  ipcMain.handle(IPC.f10Trading, (_event, code: string, section: string) =>
    fetchF10Trading(code, section)
  )

  ipcMain.handle(IPC.f10LhbMarket, () => fetchF10LhbMarket())

  ipcMain.handle(IPC.f10Market, (_event, section: string) => fetchF10Market(section))

  ipcMain.handle(IPC.f10Dividend, (_event, code: string) => fetchF10Dividend(code))

  ipcMain.handle(IPC.f10ShareholderCount, (_event, code: string) => fetchF10ShareholderCount(code))

  ipcMain.handle(IPC.f10Capital, (_event, code: string, section: string) =>
    fetchF10Capital(code, section)
  )

  ipcMain.handle(IPC.f10CirculatingShareholders, (_event, code: string) =>
    fetchF10CirculatingShareholders(code)
  )

  ipcMain.handle(IPC.f10ShareholderChanges, (_event, code: string) =>
    fetchF10ShareholderChanges(code)
  )

  ipcMain.handle(IPC.f10Institutions, (_event, code: string) => fetchF10Institutions(code))

  ipcMain.handle(IPC.f10Controller, (_event, code: string) => fetchF10Controller(code))

  ipcMain.handle(IPC.f10ChangePlans, (_event, code: string) => fetchF10ChangePlans(code))

  ipcMain.handle(IPC.marketBreadth, () => fetchMarketBreadth())

  ipcMain.handle(IPC.localDayRead, (_event, path: string, limit?: number) =>
    fetchLocalDay(path, limit)
  )

  ipcMain.handle(IPC.localImport, (_event, path: string) => fetchLocalImport(path))

  ipcMain.handle(IPC.localQuery, (_event, sql: string, limit?: number) =>
    fetchLocalQuery(sql, limit)
  )

  ipcMain.handle(IPC.localDayWrite, (_event, path: string, bars: LocalDayBar[]) =>
    writeLocalDay(path, bars)
  )

  ipcMain.handle(IPC.localMinWrite, (_event, path: string, bars: LocalDayBar[]) =>
    writeLocalMin(path, bars)
  )

  ipcMain.handle(IPC.exportKlines, (_event, req: Parameters<typeof exportKlines>[0]) =>
    exportKlines(req)
  )

  ipcMain.handle(IPC.cacheKlines, (_event, req: Parameters<typeof cacheKlines>[0]) =>
    cacheKlines(req)
  )

  ipcMain.handle(IPC.cacheFullKlines, (_event, req: Parameters<typeof cacheFullKlines>[0]) =>
    cacheFullKlines(req)
  )

  ipcMain.handle(IPC.dataInventory, () => dataInventory())

  ipcMain.handle(IPC.limitReview, (_event, date: string) => limitReview(date))

  ipcMain.handle(IPC.archiveSnapshot, () => archiveSnapshot())

  ipcMain.handle(IPC.lakeArchives, (_event, limit?: number) => fetchLakeArchives(limit))

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
    fetchKline(
      request.code,
      request.period,
      request.count ?? 200,
      request.adjust ?? 'qfq',
      undefined,
      request.cacheOnly === true
    )
  )

  /* ---------------------------------------------------------- 搜索 */

  ipcMain.handle(IPC.searchHint, (_event, keyword: string) => fetchSearchHint(keyword))

  ipcMain.handle(IPC.quoteCatalog, () => fetchSecurityCatalog())

  ipcMain.handle(IPC.quoteMac, (_event, codes: string[]) => fetchMacQuotes(codes))

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
    createChartWindow(code, {
      bounds: store.chartBounds,
      onBoundsChange: (bounds) => store.saveChartBounds(bounds)
    })
  })

  ipcMain.handle(IPC.windowSecondary, () => {
    createSecondaryWindow({
      bounds: store.secondaryBounds,
      onBoundsChange: (bounds) => store.saveSecondaryBounds(bounds)
    })
  })

  ipcMain.handle(IPC.windowServers, () => {
    createServerWindow()
  })

  ipcMain.handle(IPC.windowDisplays, (event) => {
    const window = BrowserWindow.fromWebContents(event.sender) ?? getWindow()
    return window ? listDisplays(window) : []
  })

  ipcMain.handle(IPC.windowMoveDisplay, (event, displayId: number) => {
    const window = BrowserWindow.fromWebContents(event.sender) ?? getWindow()
    return window ? moveWindowToDisplay(window, displayId) : false
  })

  ipcMain.handle(IPC.windowAlwaysOnTop, (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) return false
    const next = !window.isAlwaysOnTop()
    window.setAlwaysOnTop(next)
    return next
  })

  ipcMain.handle(IPC.windowControl, (_event, action: string) => {
    const window = getWindow()
    if (!window) {
      return { maximized: false, focused: false, fullscreen: false, platform: process.platform }
    }

    switch (action) {
      case 'minimize':
        window.minimize()
        break
      case 'toggle-maximize':
        if (window.isMaximized()) window.unmaximize()
        else window.maximize()
        break
      case 'toggle-fullscreen':
        window.setFullScreen(!window.isFullScreen())
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
      fullscreen: window.isFullScreen(),
      platform: process.platform
    }
  })

  /* -------------------------------------------------------- 其它 */

  ipcMain.handle(IPC.appGraphics, () => ({
    session: process.env.XDG_SESSION_TYPE ?? 'unknown',
    wayland: Boolean(process.env.WAYLAND_DISPLAY),
    requested: process.env.STOCKLENS_GRAPHICS ?? 'wayland',
    platform: process.platform,
    gpuFeatureStatus: app.getGPUFeatureStatus()
  }))

  ipcMain.handle(IPC.appInfo, () => ({
    name: app.getName(),
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform
  }))

  ipcMain.handle(IPC.serverSpeedTest, () => speedTestServers())

  ipcMain.handle(IPC.serverSelect, (_event, host: string) => selectServer(host))

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
