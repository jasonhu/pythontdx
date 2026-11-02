import type { MinuteTrend, MultiDayTrend } from '@shared/types'

/**
 * 分时 / 五日分时的本地快照。
 *
 * 冷启动时 sidecar 是 Nuitka 单文件，解包 + Python 启动可能 2 秒（偶发更久）；
 * 默认分时图如果只等网络，窗口会一直空着。这里把上一帧存在 localStorage，
 * ChartPanel 先用它画出来（标注「离线缓存」），网络回来再覆盖。
 *
 * 只缓存最近 12 个分时 / 6 个五日，避免撑爆 localStorage；写入节流 2 秒，
 * 因为推送每秒一帧，没必要每帧都序列化。
 */
export type TrendKind = 'minute' | 'five'
export type TrendData = MinuteTrend | MultiDayTrend

const VERSION = 1
const LIMITS: Record<TrendKind, number> = { minute: 12, five: 6 }
const KEYS: Record<TrendKind, string> = {
  minute: 'pythontdx.trend-cache-v1-minute',
  five: 'pythontdx.trend-cache-v1-five'
}
const WRITE_THROTTLE_MS = 2000

interface CacheEntry {
  savedAt: number
  data: TrendData
}

interface CacheFile {
  version: number
  entries: Record<string, CacheEntry>
}

export interface CachedTrend<T extends TrendData> {
  data: T
  savedAt: number
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

function emptyFile(): CacheFile {
  return { version: VERSION, entries: {} }
}

function isMinuteTrend(value: unknown): value is MinuteTrend {
  if (!value || typeof value !== 'object') return false
  const trend = value as Partial<MinuteTrend>
  return (
    typeof trend.code === 'string' &&
    typeof trend.name === 'string' &&
    typeof trend.date === 'string' &&
    typeof trend.prevClose === 'number' &&
    Array.isArray(trend.points)
  )
}

function isMultiDayTrend(value: unknown): value is MultiDayTrend {
  if (!value || typeof value !== 'object') return false
  const trend = value as Partial<MultiDayTrend>
  return (
    typeof trend.code === 'string' &&
    typeof trend.name === 'string' &&
    Array.isArray(trend.days) &&
    trend.days.every(isMinuteTrend)
  )
}

function readFile(kind: TrendKind): CacheFile {
  const store = storage()
  if (!store) return emptyFile()
  try {
    const raw = store.getItem(KEYS[kind])
    if (!raw) return emptyFile()
    const parsed = JSON.parse(raw) as Partial<CacheFile>
    if (parsed.version !== VERSION || !parsed.entries || typeof parsed.entries !== 'object') {
      return emptyFile()
    }
    const entries: Record<string, CacheEntry> = {}
    for (const [code, entry] of Object.entries(parsed.entries)) {
      if (
        entry &&
        typeof entry === 'object' &&
        typeof entry.savedAt === 'number' &&
        entry.data &&
        typeof entry.data === 'object'
      ) {
        entries[code] = { savedAt: entry.savedAt, data: entry.data as TrendData }
      }
    }
    return { version: VERSION, entries }
  } catch {
    return emptyFile()
  }
}

export function readTrendCache<T extends TrendData>(
  kind: TrendKind,
  code: string
): CachedTrend<T> | null {
  const entry = readFile(kind).entries[code]
  if (!entry) return null
  const valid = kind === 'minute' ? isMinuteTrend(entry.data) : isMultiDayTrend(entry.data)
  if (!valid || entry.data.code !== code) return null
  return { data: entry.data as T, savedAt: entry.savedAt }
}

export function writeTrendCache<T extends TrendData>(kind: TrendKind, code: string, data: T): void {
  const store = storage()
  if (!store) return
  const file = readFile(kind)
  const now = Date.now()
  const existing = file.entries[code]
  if (existing && now - existing.savedAt < WRITE_THROTTLE_MS) return

  file.entries[code] = { savedAt: now, data }
  const kept = Object.entries(file.entries)
    .sort((a, b) => b[1].savedAt - a[1].savedAt)
    .slice(0, LIMITS[kind])
  try {
    store.setItem(
      KEYS[kind],
      JSON.stringify({ version: VERSION, entries: Object.fromEntries(kept) })
    )
  } catch {
    // 配额不足/隐私模式时静默放弃；网络数据仍能正常显示。
  }
}
