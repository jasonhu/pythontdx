/**
 * 预加载脚本 —— 主进程与渲染进程之间唯一的「官方通道」。
 *
 * 安全模型（Electron 的黄金三条）：
 *   1. contextIsolation: true —— 渲染层的 window 和 preload 的 window 是两个世界；
 *   2. nodeIntegration: false —— 页面里拿不到 require / process；
 *   3. 只挂载白名单 API —— 渲染层能调什么，完全由这里决定，而不是把 ipcRenderer 整个丢出去。
 *
 * 注意：这里永远不要把 ipcRenderer 本身暴露给页面，
 * 否则页面就能给任意通道发消息，等同于关掉了整个隔离层。
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC, type StockLensApi } from '@shared/ipc'
import type { WindowState } from '@shared/types'

/** 订阅主进程推送，返回取消订阅的函数（供渲染层 onCleanup 调用） */
function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const handler = (_event: IpcRendererEvent, payload: T): void => listener(payload)
  ipcRenderer.on(channel, handler)
  return () => {
    ipcRenderer.removeListener(channel, handler)
  }
}

const api: StockLensApi = {
  quote: {
    snapshot: (codes) => ipcRenderer.invoke(IPC.quoteSnapshot, codes),
    subscribe: (codes, intervalMs) => ipcRenderer.invoke(IPC.quoteSubscribe, codes, intervalMs),
    unsubscribe: () => ipcRenderer.invoke(IPC.quoteUnsubscribe),
    onUpdate: (listener) => subscribe(IPC.quoteUpdate, listener),
    category: (request) => ipcRenderer.invoke(IPC.quoteCategory, request),
    catalog: () => ipcRenderer.invoke(IPC.quoteCatalog),
    macQuotes: (codes) => ipcRenderer.invoke(IPC.quoteMac, codes),
    macQuotesFinance: (codes) => ipcRenderer.invoke(IPC.quoteMacFinance, codes)
  },
  trade: {
    ticks: (request) => ipcRenderer.invoke(IPC.tradeTicks, request)
  },
  money: {
    flow: (code) => ipcRenderer.invoke(IPC.moneyFlow, code),
    macFlow: (code) => ipcRenderer.invoke(IPC.moneyMac, code),
    macFlowBatch: (codes, workers) => ipcRenderer.invoke(IPC.moneyMacBatch, codes, workers)
  },
  mac: {
    unusual: (count) => ipcRenderer.invoke(IPC.macUnusual, count),
    boards: (boardType) => ipcRenderer.invoke(IPC.macBoards, boardType)
  },
  auction: {
    series: (code, date) => ipcRenderer.invoke(IPC.auctionSeries, code, date),
    archiveSave: (code, date) => ipcRenderer.invoke(IPC.auctionArchiveSave, code, date),
    archiveRead: (code, date) => ipcRenderer.invoke(IPC.auctionArchiveRead, code, date),
    archiveList: (limit) => ipcRenderer.invoke(IPC.auctionArchiveList, limit),
    archiveBatch: (codes, date) => ipcRenderer.invoke(IPC.auctionArchiveBatch, codes, date)
  },
  market: {
    breadth: () => ipcRenderer.invoke(IPC.marketBreadth)
  },
  f10: {
    catalog: (code) => ipcRenderer.invoke(IPC.f10Catalog, code),
    content: (code, section) => ipcRenderer.invoke(IPC.f10Content, code, section),
    announcements: (code) => ipcRenderer.invoke(IPC.f10Announcements, code),
    profile: (code) => ipcRenderer.invoke(IPC.f10Profile, code),
    valuation: (code) => ipcRenderer.invoke(IPC.f10Valuation, code),
    finance: (code) => ipcRenderer.invoke(IPC.f10Finance, code),
    business: (code) => ipcRenderer.invoke(IPC.f10Business, code),
    shareholders: (code) => ipcRenderer.invoke(IPC.f10Shareholders, code),
    reports: (code) => ipcRenderer.invoke(IPC.f10Reports, code),
    news: (code) => ipcRenderer.invoke(IPC.f10News, code),
    industry: (code, section) => ipcRenderer.invoke(IPC.f10Industry, code, section),
    trading: (code, section) => ipcRenderer.invoke(IPC.f10Trading, code, section),
    lhbMarket: () => ipcRenderer.invoke(IPC.f10LhbMarket),
    market: (section) => ipcRenderer.invoke(IPC.f10Market, section),
    dividend: (code) => ipcRenderer.invoke(IPC.f10Dividend, code),
    shareholderCount: (code) => ipcRenderer.invoke(IPC.f10ShareholderCount, code),
    capital: (code, section) => ipcRenderer.invoke(IPC.f10Capital, code, section),
    circulatingShareholders: (code) => ipcRenderer.invoke(IPC.f10CirculatingShareholders, code),
    shareholderChanges: (code) => ipcRenderer.invoke(IPC.f10ShareholderChanges, code),
    institutions: (code) => ipcRenderer.invoke(IPC.f10Institutions, code),
    controller: (code) => ipcRenderer.invoke(IPC.f10Controller, code),
    changePlans: (code) => ipcRenderer.invoke(IPC.f10ChangePlans, code),
    statement: (code, kind, full) => ipcRenderer.invoke(IPC.f10Statement, code, kind, full)
  },
  data: {
    statsSummary: () => ipcRenderer.invoke(IPC.dataStatsSummary),
    statsExport: () => ipcRenderer.invoke(IPC.dataStatsExport),
    statsQuery: (sql, limit) => ipcRenderer.invoke(IPC.dataStatsQuery, sql, limit),
    statsCsv: () => ipcRenderer.invoke(IPC.dataStatsCsv),
    statsParquet: () => ipcRenderer.invoke(IPC.dataStatsParquet),
    duckQuery: (sql, limit) => ipcRenderer.invoke(IPC.dataDuckQuery, sql, limit),
    localDay: (path, limit) => ipcRenderer.invoke(IPC.localDayRead, path, limit),
    localImport: (path) => ipcRenderer.invoke(IPC.localImport, path),
    localQuery: (sql, limit) => ipcRenderer.invoke(IPC.localQuery, sql, limit),
    localDayWrite: (path, bars) => ipcRenderer.invoke(IPC.localDayWrite, path, bars),
    localMinWrite: (path, bars) => ipcRenderer.invoke(IPC.localMinWrite, path, bars),
    exportKlines: (req) => ipcRenderer.invoke(IPC.exportKlines, req),
    cacheKlines: (req) => ipcRenderer.invoke(IPC.cacheKlines, req),
    fullCacheKlines: (req) => ipcRenderer.invoke(IPC.cacheFullKlines, req),
    inventory: () => ipcRenderer.invoke(IPC.dataInventory),
    limitReview: (date) => ipcRenderer.invoke(IPC.limitReview, date),
    archiveSnapshot: () => ipcRenderer.invoke(IPC.archiveSnapshot),
    lakeArchives: (limit) => ipcRenderer.invoke(IPC.lakeArchives, limit)
  },
  block: {
    list: (kind) => ipcRenderer.invoke(IPC.blockList, kind),
    industries: () => ipcRenderer.invoke(IPC.blockIndustries)
  },
  screen: {
    run: (request) => ipcRenderer.invoke(IPC.screenRun, request),
    formula: (request) => ipcRenderer.invoke(IPC.screenFormula, request),
    formulaBacktest: (request) => ipcRenderer.invoke(IPC.screenFormulaBacktest, request)
  },
  trend: {
    minute: (code) => ipcRenderer.invoke(IPC.trendMinute, code),
    fiveDay: (code) => ipcRenderer.invoke(IPC.trendFiveDay, code),
    kline: (request) => ipcRenderer.invoke(IPC.trendKline, request)
  },
  search: {
    hint: (keyword) => ipcRenderer.invoke(IPC.searchHint, keyword)
  },
  state: {
    get: () => ipcRenderer.invoke(IPC.stateGet),
    patch: (patch) => ipcRenderer.invoke(IPC.statePatch, patch)
  },
  window: {
    control: (action) => ipcRenderer.invoke(IPC.windowControl, action),
    openChart: (code) => ipcRenderer.invoke(IPC.windowChart, code),
    openSecondary: () => ipcRenderer.invoke(IPC.windowSecondary),
    openServers: () => ipcRenderer.invoke(IPC.windowServers),
    toggleAlwaysOnTop: () => ipcRenderer.invoke(IPC.windowAlwaysOnTop),
    displays: () => ipcRenderer.invoke(IPC.windowDisplays),
    moveToDisplay: (displayId) => ipcRenderer.invoke(IPC.windowMoveDisplay, displayId),
    onStateChange: (listener) => subscribe<WindowState>(IPC.windowState, listener)
  },
  app: {
    info: () => ipcRenderer.invoke(IPC.appInfo),
    graphics: () => ipcRenderer.invoke(IPC.appGraphics),
    serverSpeedTest: () => ipcRenderer.invoke(IPC.serverSpeedTest),
    selectServer: (host) => ipcRenderer.invoke(IPC.serverSelect, host),
    openExternal: (url) => ipcRenderer.invoke(IPC.appOpenExternal, url),
    notify: (title, body) => ipcRenderer.invoke(IPC.appNotify, title, body)
  }
}

contextBridge.exposeInMainWorld('api', api)
