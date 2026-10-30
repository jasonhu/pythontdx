/**
 * 本地预警运行时：行情帧到达时求值，触发的规则写入当日状态。
 *
 * 只做客户端提示，不产生交易动作；历史事件保存在内存里，刷新页面后清空，
 * 规则本身在 AppState 中持久化。
 */
import { createSignal } from 'solid-js'
import type { AlertEvent, Quote } from '@shared/types'
import { evaluateAlerts } from '@shared/alerts'
import { api } from '../lib/ipc'
import { appState, markAlertsTriggered } from './app'

const [events, setEvents] = createSignal<AlertEvent[]>([])
const [latest, setLatest] = createSignal<AlertEvent | null>(null)

export { events as alertEvents, latest as latestAlert }

export function scanAlerts(quotes: readonly Quote[], now = Date.now()): void {
  if (appState.alerts.length === 0 || quotes.length === 0) return
  const scan = evaluateAlerts(appState.alerts, quotes, now)
  if (scan.updated.length > 0) markAlertsTriggered(scan.updated)
  if (scan.events.length > 0) {
    setEvents((previous) => [...scan.events, ...previous].slice(0, 50))
    setLatest(scan.events[scan.events.length - 1] ?? null)
    for (const event of scan.events) {
      void api.app.notify('StockLens 预警', event.message).catch(() => undefined)
    }
  }
}

export function dismissLatestAlert(): void {
  setLatest(null)
}

export function clearAlertEvents(): void {
  setEvents([])
  setLatest(null)
}
