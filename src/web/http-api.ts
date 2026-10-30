/**
 * Web 端的 window.api 实现。
 *
 * 桌面走 preload + IPC；浏览器不能碰 IPC，所以这里用只读 HTTP API 实现同一份
 * StockLensApi 契约。组件仍然只依赖 window.api，不需要知道自己在哪一端。
 */
import type {
  AppInfo,
  AppState,
  AuctionPoint,
  CategoryQuote,
  F10Section,
  KLineSeries,
  MinuteTrend,
  MoneyFlowRecord,
  MultiDayTrend,
  Quote,
  QuoteUpdate,
  SearchItem,
  TradeTick
} from '@shared/types'
import type { CategoryRequest, KLineRequest, StockLensApi, TradesRequest } from '@shared/ipc'
import type { SearchEntry, SearchSecurity } from '@shared/search'
import { DEFAULT_GROUP_ID, DEFAULT_SETTINGS, SEED_GROUPS, STATE_VERSION } from '@shared/types'

const BASE = (import.meta.env.VITE_STOCKLENS_API ?? '').replace(/\/$/, '')
const FORCE_POLLING = new URLSearchParams(window.location.search).get('transport') === 'poll'
const STORAGE_KEY = 'stocklens:web:state'

interface ApiEnvelope<T> {
  ok: boolean
  result?: T
  error?: string
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers ?? {})
    }
  })
  let payload: ApiEnvelope<T>
  try {
    payload = (await response.json()) as ApiEnvelope<T>
  } catch {
    throw new Error(`HTTP ${response.status}`)
  }
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || `HTTP ${response.status}`)
  }
  return payload.result as T
}

function post<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, { method: 'POST', body: JSON.stringify(body) })
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function loadState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as AppState
      if (Array.isArray(parsed.groups) && parsed.groups.length > 0) {
        return {
          version: STATE_VERSION,
          groups: parsed.groups,
          activeGroupId: parsed.activeGroupId || parsed.groups[0].id,
          settings: { ...DEFAULT_SETTINGS, ...parsed.settings },
          activeCode: parsed.activeCode ?? parsed.groups[0]?.items[0]?.code ?? null
        }
      }
    }
  } catch {
    // 坏配置不阻塞页面，回到种子数据
  }
  const groups = clone(SEED_GROUPS)
  return {
    version: STATE_VERSION,
    groups,
    activeGroupId: DEFAULT_GROUP_ID,
    settings: { ...DEFAULT_SETTINGS },
    activeCode: groups[0]?.items[0]?.code ?? null
  }
}

export function createHttpApi(): StockLensApi {
  let state = loadState()
  const listeners = new Set<(update: QuoteUpdate) => void>()
  let codes: string[] = []
  let timer: number | undefined
  let stream: EventSource | undefined
  let pollId = 0
  let searchCache: SearchEntry[] | null = null
  let searchModule: Promise<typeof import('@shared/search')> | null = null

  const save = (): AppState => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    return state
  }

  const poll = async (): Promise<void> => {
    const current = ++pollId
    try {
      const quotes = await post<Quote[]>('/api/quotes', { codes })
      if (current !== pollId) return
      const update: QuoteUpdate = { quotes, at: Date.now() }
      listeners.forEach((listener) => listener(update))
    } catch (error) {
      if (current !== pollId) return
      const update: QuoteUpdate = {
        quotes: [],
        at: Date.now(),
        error: error instanceof Error ? error.message : String(error)
      }
      listeners.forEach((listener) => listener(update))
    }
  }

  const stopPolling = (): void => {
    if (timer !== undefined) window.clearInterval(timer)
    timer = undefined
    stream?.close()
    stream = undefined
    pollId += 1
  }

  const startPolling = (intervalMs: number): void => {
    timer = window.setInterval(() => void poll(), Math.max(1000, intervalMs || 3000))
  }

  const startStream = (intervalMs: number): void => {
    const params = new URLSearchParams({
      codes: codes.join(','),
      interval: String(Math.max(1000, intervalMs || 3000))
    })
    stream = new EventSource(`${BASE}/api/stream?${params.toString()}`)
    stream.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as {
          ok: boolean
          result?: { quotes: Quote[]; at: number }
        }
        if (!payload.ok || !payload.result) return
        const update: QuoteUpdate = {
          quotes: payload.result.quotes,
          at: payload.result.at
        }
        listeners.forEach((listener) => listener(update))
      } catch {
        // 单帧坏数据不打断连接
      }
    }
  }

  const searchHint = async (keyword: string): Promise<SearchItem[]> => {
    if (!keyword.trim()) return []
    // pinyin-pro 词典较大，首次搜索时才加载，避免拖慢首屏
    searchModule ??= import('@shared/search')
    const { buildSearchEntries, searchEntries } = await searchModule
    if (!searchCache) {
      const all = await request<SearchSecurity[]>('/api/code_list')
      searchCache = buildSearchEntries(all)
    }
    return searchEntries(searchCache, keyword)
  }

  const api: StockLensApi = {
    quote: {
      snapshot: (list) => post<Quote[]>('/api/quotes', { codes: list }),
      subscribe: async (list, intervalMs) => {
        codes = [...list]
        stopPolling()
        if (codes.length === 0) return
        await poll()
        if (FORCE_POLLING || typeof EventSource === 'undefined') {
          startPolling(intervalMs)
          return
        }
        startStream(intervalMs)
      },
      unsubscribe: async () => {
        stopPolling()
        codes = []
      },
      onUpdate: (listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      category: (req: CategoryRequest) => post<CategoryQuote[]>('/api/category', req)
    },
    trade: {
      ticks: (req: TradesRequest) => post<TradeTick[]>('/api/trades', req)
    },
    money: {
      flow: (code) => post<MoneyFlowRecord[]>('/api/money_flow', { code })
    },
    auction: {
      series: (code, date) => post<AuctionPoint[]>('/api/auctions', { code, date })
    },
    f10: {
      catalog: (code) => post<F10Section[]>('/api/f10_catalog', { code }),
      content: (code, section) =>
        post<string>('/api/f10_content', {
          code,
          filename: section.filename,
          start: section.start,
          length: section.length
        })
    },
    trend: {
      minute: (code) => request<MinuteTrend>(`/api/minute?code=${encodeURIComponent(code)}`),
      fiveDay: (code) => request<MultiDayTrend>(`/api/five_day?code=${encodeURIComponent(code)}`),
      kline: (req: KLineRequest) => {
        const params = new URLSearchParams({
          code: req.code,
          period: req.period,
          count: String(req.count ?? 200)
        })
        return request<KLineSeries>(`/api/kline?${params.toString()}`)
      }
    },
    search: { hint: searchHint },
    state: {
      get: async () => state,
      patch: async (patch) => {
        state = {
          ...state,
          ...patch,
          settings: { ...state.settings, ...patch.settings }
        }
        return save()
      }
    },
    window: {
      control: async () => ({ focused: true, maximized: false, platform: 'web' }),
      onStateChange: () => () => undefined
    },
    app: {
      info: async (): Promise<AppInfo> => ({
        name: 'StockLens Web',
        version: '0.7.0-web',
        electron: '—',
        chrome: navigator.userAgent,
        node: '—',
        platform: 'web'
      }),
      openExternal: async (url) => {
        window.open(url, '_blank', 'noopener,noreferrer')
      }
    }
  }
  return api
}
