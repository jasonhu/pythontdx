/**
 * 本地行情预警：纯函数，桌面/Web 与测试共用。
 *
 * 规则只在客户端计算，不生成交易指令；同一条规则同一本地日期只触发一次，
 * 避免 3 秒行情流把提示刷屏。
 */
import type { AlertEvent, AlertMetric, AlertRule, Quote } from './types'

export const ALERT_METRIC_LABELS: Record<AlertMetric, string> = {
  price: '价格',
  changePct: '涨幅',
  volumeRatio: '量比',
  turnoverRate: '换手率',
  amplitude: '振幅'
}

export function alertMetricValue(metric: AlertMetric, quote: Quote): number {
  switch (metric) {
    case 'price':
      return quote.price
    case 'changePct':
      return quote.changePct
    case 'volumeRatio':
      return quote.volumeRatio ?? Number.NaN
    case 'turnoverRate':
      return quote.turnoverRate ?? Number.NaN
    case 'amplitude':
      return quote.amplitude ?? Number.NaN
  }
}

export function formatAlertValue(metric: AlertMetric, value: number): string {
  if (metric === 'price') return value.toFixed(2)
  if (metric === 'volumeRatio') return `${value.toFixed(2)}x`
  return `${value.toFixed(2)}%`
}

export function localDate(now: number): string {
  const date = new Date(now)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

function metricValue(rule: AlertRule, quote: Quote): number {
  return alertMetricValue(rule.metric, quote)
}

function formatValue(rule: AlertRule, value: number): string {
  return formatAlertValue(rule.metric, value)
}

export interface AlertScan {
  events: AlertEvent[]
  /** 只包含 lastTriggeredDate 需要更新的规则 */
  updated: AlertRule[]
}

export function evaluateAlerts(
  rules: readonly AlertRule[],
  quotes: readonly Quote[],
  now: number
): AlertScan {
  const date = localDate(now)
  const quoteMap = new Map(quotes.map((quote) => [quote.code, quote]))
  const events: AlertEvent[] = []
  const updated: AlertRule[] = []

  for (const rule of rules) {
    if (!rule.enabled) continue
    if (rule.lastTriggeredDate === date) continue
    const quote = quoteMap.get(rule.code)
    if (!quote) continue
    const value = metricValue(rule, quote)
    if (!Number.isFinite(value)) continue
    const triggered = rule.direction === 'above' ? value >= rule.value : value <= rule.value
    if (!triggered) continue

    const next = { ...rule, lastTriggeredDate: date }
    const label = rule.direction === 'above' ? '≥' : '≤'
    events.push({
      rule: next,
      quote,
      at: now,
      message: `${rule.name} ${ALERT_METRIC_LABELS[rule.metric]} ${formatValue(
        rule,
        value
      )} ${label} ${formatValue(rule, rule.value)}`
    })
    updated.push(next)
  }

  return { events, updated }
}
