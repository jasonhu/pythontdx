/**
 * 全局应用状态：自选股、设置、选中项、运行时信息。
 *
 * 单一数据源放在渲染进程，主进程只负责「持久化」。
 * 这样界面上任何操作都是先改本地状态（立刻响应），再异步落盘（不阻塞 UI）。
 */
import { createSignal } from 'solid-js'
import { createStore } from 'solid-js/store'
import {
  DEFAULT_SETTINGS,
  type AppInfo,
  type AppSettings,
  type AppState,
  type SearchItem,
  type WatchItem
} from '@shared/types'
import { api } from '../lib/ipc'

const [state, setState] = createStore<AppState>({
  version: 1,
  watchlist: [],
  settings: { ...DEFAULT_SETTINGS },
  activeCode: null
})

const [appInfo, setAppInfo] = createSignal<AppInfo | null>(null)
const [ready, setReady] = createSignal(false)

export { state as appState, appInfo, ready as appReady }

/** 自选股代码列表（给行情订阅用，保持顺序稳定） */
export const watchCodes = (): string[] => state.watchlist.map((item) => item.code)

export const activeQuoteCode = (): string | null => state.activeCode

/* ------------------------------------------------------------------ 启动 */

export async function bootstrapAppState(): Promise<void> {
  const [persisted, info] = await Promise.all([api.state.get(), api.app.info()])

  setState({
    version: persisted.version,
    watchlist: persisted.watchlist,
    settings: { ...DEFAULT_SETTINGS, ...persisted.settings },
    activeCode: persisted.activeCode ?? persisted.watchlist[0]?.code ?? null
  })
  setAppInfo(info)

  // 告诉 CSS 当前平台，macOS 需要给原生红绿灯留位置
  document.documentElement.dataset.platform = info.platform
  setReady(true)
}

/* ---------------------------------------------------------------- 自选股 */

export function setActiveCode(code: string | null): void {
  setState('activeCode', code)
  persist({ activeCode: code })
}

export function addWatchItem(item: Pick<WatchItem, 'code' | 'name' | 'market'>): void {
  const exists = state.watchlist.some((entry) => entry.code === item.code)
  if (exists) {
    setActiveCode(item.code)
    return
  }

  const watchlist = [...state.watchlist, { ...item }]
  setState('watchlist', watchlist)
  persist({ watchlist })
  setActiveCode(item.code)
}

export function addSearchItem(item: SearchItem): void {
  addWatchItem({ code: item.code, name: item.name, market: item.market })
}

export function removeWatchItem(code: string): void {
  const index = state.watchlist.findIndex((entry) => entry.code === code)
  if (index < 0) return

  const watchlist = state.watchlist.filter((entry) => entry.code !== code)
  setState('watchlist', watchlist)
  persist({ watchlist })

  // 删掉的正好是当前选中项时，顺延到相邻的一只，避免主区突然空掉
  if (state.activeCode === code) {
    const next = watchlist[Math.min(index, watchlist.length - 1)]
    setActiveCode(next?.code ?? null)
  }
}

export function moveWatchItem(code: string, offset: number): void {
  const index = state.watchlist.findIndex((entry) => entry.code === code)
  const target = index + offset
  if (index < 0 || target < 0 || target >= state.watchlist.length) return

  const watchlist = [...state.watchlist]
  const [moved] = watchlist.splice(index, 1)
  watchlist.splice(target, 0, moved)

  setState('watchlist', watchlist)
  persist({ watchlist })
}

/* ------------------------------------------------------------------ 设置 */

export function updateSettings(patch: Partial<AppSettings>): void {
  setState('settings', patch)
  persist({ settings: { ...state.settings } })
}

export function toggleTheme(): void {
  updateSettings({ theme: state.settings.theme === 'dark' ? 'light' : 'dark' })
}

/* ------------------------------------------------------------------ 落盘 */

function persist(patch: Partial<AppState>): void {
  void api.state.patch(patch).catch((error) => {
    console.error('[app-state] 保存失败：', error)
  })
}
