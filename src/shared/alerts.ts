/**
 * 本地行情预警：纯函数，桌面/Web 与测试共用。
 *
 * 规则只在客户端计算，不生成交易指令；同一条规则同一本地日期只触发一次，
 * 避免 3 秒行情流把提示刷屏。
 */
import type { AlertCondition, AlertEvent, AlertMetric, AlertRule, Quote } from './types'

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

export function ruleConditions(rule: AlertRule): AlertCondition[] {
  if (rule.conditions && rule.conditions.length > 0) return rule.conditions
  return [{ metric: rule.metric, direction: rule.direction, value: rule.value }]
}

function matches(condition: AlertCondition, value: number): boolean {
  return condition.direction === 'above' ? value >= condition.value : value <= condition.value
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
    const conditions = ruleConditions(rule)
    const values = conditions.map((condition) => alertMetricValue(condition.metric, quote))
    if (values.some((value) => !Number.isFinite(value))) continue
    if (!conditions.every((condition, index) => matches(condition, values[index]))) continue

    const next = { ...rule, lastTriggeredDate: date }
    const description = conditions
      .map((condition, index) => {
        const label = condition.direction === 'above' ? '≥' : '≤'
        return `${ALERT_METRIC_LABELS[condition.metric]} ${formatAlertValue(
          condition.metric,
          values[index]
        )} ${label} ${formatAlertValue(condition.metric, condition.value)}`
      })
      .join(' 且 ')
    events.push({
      rule: next,
      quote,
      at: now,
      message: `${rule.name} ${description}`
    })
    updated.push(next)
  }

  return { events, updated }
}
