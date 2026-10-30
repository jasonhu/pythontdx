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
    category: (request) => ipcRenderer.invoke(IPC.quoteCategory, request)
  },
  trade: {
    ticks: (request) => ipcRenderer.invoke(IPC.tradeTicks, request)
  },
  money: {
    flow: (code) => ipcRenderer.invoke(IPC.moneyFlow, code)
  },
  auction: {
    series: (code, date) => ipcRenderer.invoke(IPC.auctionSeries, code, date)
  },
  f10: {
    catalog: (code) => ipcRenderer.invoke(IPC.f10Catalog, code),
    content: (code, section) => ipcRenderer.invoke(IPC.f10Content, code, section),
    announcements: (code) => ipcRenderer.invoke(IPC.f10Announcements, code),
    profile: (code) => ipcRenderer.invoke(IPC.f10Profile, code)
  },
  data: {
    statsSummary: () => ipcRenderer.invoke(IPC.dataStatsSummary),
    statsExport: () => ipcRenderer.invoke(IPC.dataStatsExport),
    statsQuery: (sql, limit) => ipcRenderer.invoke(IPC.dataStatsQuery, sql, limit),
    statsCsv: () => ipcRenderer.invoke(IPC.dataStatsCsv)
  },
  block: {
    list: (kind) => ipcRenderer.invoke(IPC.blockList, kind),
    industries: () => ipcRenderer.invoke(IPC.blockIndustries)
  },
  screen: {
    run: (request) => ipcRenderer.invoke(IPC.screenRun, request)
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
    onStateChange: (listener) => subscribe<WindowState>(IPC.windowState, listener)
  },
  app: {
    info: () => ipcRenderer.invoke(IPC.appInfo),
    openExternal: (url) => ipcRenderer.invoke(IPC.appOpenExternal, url),
    notify: (title, body) => ipcRenderer.invoke(IPC.appNotify, title, body)
  }
}

contextBridge.exposeInMainWorld('api', api)
