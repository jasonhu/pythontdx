/**
 * 本地行情预警：规则编辑 + 今日触发记录。
 *
 * 规则只存在本机，不做条件单/交易；同一规则同一交易日只提示一次。
 */
import { createEffect, createSignal, For, untrack, Show, type JSX } from 'solid-js'
import type { AlertCondition, AlertDirection, AlertMetric, AlertRule, Quote } from '@shared/types'
import { ALERT_METRIC_LABELS, alertMetricValue, formatAlertValue } from '@shared/alerts'
import { fixed, signedPct } from '@shared/format'
import { addAlert, appState, removeAlert, toggleAlert } from '../stores/app'
import { alertEvents } from '../stores/alerts'
import { IconBell, IconClose } from './Icons'

interface AlertPanelProps {
  quote: Quote | undefined
  onClose: () => void
  onSelect: (code: string) => void
}

function describeConditions(rule: AlertRule): string {
  const conditions: AlertCondition[] =
    rule.conditions && rule.conditions.length > 0
      ? rule.conditions
      : [{ metric: rule.metric, direction: rule.direction, value: rule.value }]
  return conditions
    .map((condition) => {
      const label = condition.direction === 'above' ? '≥' : '≤'
      return `${ALERT_METRIC_LABELS[condition.metric]} ${label} ${formatAlertValue(
        condition.metric,
        condition.value
      )}`
    })
    .join(' 且 ')
}

export function AlertPanel(props: AlertPanelProps): JSX.Element {
  const [metric, setMetric] = createSignal<AlertMetric>('price')
  const [direction, setDirection] = createSignal<AlertDirection>('above')
  const [value, setValue] = createSignal('')
  const [error, setError] = createSignal<string | null>(null)
  const [combo, setCombo] = createSignal(false)
  const [comboMetric, setComboMetric] = createSignal<AlertMetric>('changePct')
  const [comboDirection, setComboDirection] = createSignal<AlertDirection>('above')
  const [comboValue, setComboValue] = createSignal('')

  // 切换股票时用当前价/涨幅作为输入初值；只在 code 改变时重置
  createEffect(() => {
    const code = props.quote?.code
    if (!code) return
    const initial = untrack(() => props.quote)
    setValue(initial ? (initial.price > 0 ? fixed(initial.price) : fixed(initial.changePct)) : '')
    setMetric('price')
    setDirection('above')
    setCombo(false)
    setComboMetric('changePct')
    setComboDirection('above')
    setComboValue('')
    setError(null)
  })

  const submit = (): void => {
    const quote = props.quote
    if (!quote) return
    const parsed = Number(value())
    if (!Number.isFinite(parsed)) {
      setError('请输入有效阈值')
      return
    }
    const conditions = combo()
      ? [
          { metric: metric(), direction: direction(), value: parsed },
          {
            metric: comboMetric(),
            direction: comboDirection(),
            value: Number(comboValue())
          }
        ]
      : undefined
    if (conditions && conditions.some((condition) => !Number.isFinite(condition.value))) {
      setError('请输入有效的组合条件阈值')
      return
    }
    addAlert({
      code: quote.code,
      name: quote.name,
      metric: metric(),
      direction: direction(),
      value: parsed,
      conditions
    })
    setError(null)
  }

  const changeMetric = (next: AlertMetric): void => {
    setMetric(next)
    const quote = props.quote
    if (!quote) return
    const initial = alertMetricValue(next, quote)
    setValue(Number.isFinite(initial) ? initial.toFixed(2) : '')
  }

  return (
    <div class="alert-backdrop" onClick={() => props.onClose()}>
      <section
        class="alert-panel"
        role="dialog"
        aria-modal="true"
        aria-label="行情预警"
        onClick={(event) => event.stopPropagation()}
      >
        <header class="alert__head">
          <div>
            <div class="alert__eyebrow">本地规则 · 同一天只提示一次</div>
            <h2 class="alert__title">行情预警</h2>
          </div>
          <button class="btn btn--icon btn--bare" title="关闭预警" onClick={() => props.onClose()}>
            <IconClose size={16} />
          </button>
        </header>

        <div class="alert__body">
          <Show
            when={props.quote}
            fallback={<div class="alert__hint">先在左侧选一只股票，再添加预警。</div>}
          >
            {(quote) => (
              <div class="alert__current">
                <IconBell size={14} />
                <span>
                  {quote().name} <code>{quote().code.toUpperCase()}</code>
                </span>
                <span class="num">{fixed(quote().price)}</span>
                <span
                  class="num"
                  classList={{
                    'tone-up': quote().changePct > 0,
                    'tone-down': quote().changePct < 0
                  }}
                >
                  {signedPct(quote().changePct)}
                </span>
              </div>
            )}
          </Show>

          <div class="alert__form">
            <select
              class="alert__select"
              value={metric()}
              aria-label="预警指标"
              onChange={(event) => changeMetric(event.currentTarget.value as AlertMetric)}
            >
              <For each={Object.entries(ALERT_METRIC_LABELS)}>
                {([value, label]) => <option value={value}>{label}</option>}
              </For>
            </select>
            <select
              class="alert__select"
              value={direction()}
              aria-label="触发方向"
              onChange={(event) => setDirection(event.currentTarget.value as AlertDirection)}
            >
              <option value="above">≥</option>
              <option value="below">≤</option>
            </select>
            <input
              class="alert__input"
              type="number"
              step="0.01"
              placeholder={
                metric() === 'price'
                  ? '阈值价格'
                  : metric() === 'volumeRatio'
                    ? '阈值量比'
                    : '阈值 %'
              }
              value={value()}
              onInput={(event) => setValue(event.currentTarget.value)}
            />
            <button class="btn btn--primary alert__add" disabled={!props.quote} onClick={submit}>
              添加
            </button>
          </div>
          <label class="alert__combo-toggle">
            <input
              type="checkbox"
              checked={combo()}
              onChange={(event) => setCombo(event.currentTarget.checked)}
            />
            再同时满足一个条件
          </label>

          <Show when={combo()}>
            <div class="alert__form alert__form--secondary">
              <select
                class="alert__select"
                value={comboMetric()}
                aria-label="组合条件指标"
                onChange={(event) => setComboMetric(event.currentTarget.value as AlertMetric)}
              >
                <For each={Object.entries(ALERT_METRIC_LABELS)}>
                  {([value, label]) => <option value={value}>{label}</option>}
                </For>
              </select>
              <select
                class="alert__select"
                value={comboDirection()}
                aria-label="组合条件方向"
                onChange={(event) => setComboDirection(event.currentTarget.value as AlertDirection)}
              >
                <option value="above">≥</option>
                <option value="below">≤</option>
              </select>
              <input
                class="alert__input"
                type="number"
                step="0.01"
                placeholder="组合阈值"
                value={comboValue()}
                onInput={(event) => setComboValue(event.currentTarget.value)}
              />
            </div>
          </Show>

          <Show when={error()}>
            <div class="alert__error">{error()}</div>
          </Show>

          <section class="alert__section">
            <div class="alert__section-head">
              <span>规则</span>
              <span>{appState.alerts.length} 条</span>
            </div>
            <Show
              when={appState.alerts.length > 0}
              fallback={<div class="alert__empty">还没有规则</div>}
            >
              <div class="alert__rules">
                <For each={appState.alerts}>
                  {(rule) => (
                    <div class="alert__rule" classList={{ 'alert__rule--off': !rule.enabled }}>
                      <input
                        type="checkbox"
                        checked={rule.enabled}
                        title={rule.enabled ? '暂停规则' : '启用规则'}
                        onChange={() => toggleAlert(rule.id)}
                      />
                      <button class="alert__rule-main" onClick={() => props.onSelect(rule.code)}>
                        <span class="alert__rule-name">{rule.name}</span>
                        <span class="alert__rule-desc">{describeConditions(rule)}</span>
                      </button>
                      <span class="alert__rule-state">
                        {rule.lastTriggeredDate ? `已触发 ${rule.lastTriggeredDate}` : '等待'}
                      </span>
                      <button
                        class="alert__delete"
                        title="删除规则"
                        onClick={() => removeAlert(rule.id)}
                      >
                        ×
                      </button>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </section>

          <section class="alert__section">
            <div class="alert__section-head">
              <span>本次运行已触发</span>
              <span>{alertEvents().length} 条</span>
            </div>
            <Show
              when={alertEvents().length > 0}
              fallback={<div class="alert__empty">还没有触发记录</div>}
            >
              <div class="alert__events">
                <For each={alertEvents().slice(0, 8)}>
                  {(event) => (
                    <button class="alert__event" onClick={() => props.onSelect(event.rule.code)}>
                      <span>{event.message}</span>
                      <time>{new Date(event.at).toLocaleTimeString('zh-CN')}</time>
                    </button>
                  )}
                </For>
              </div>
            </Show>
          </section>
        </div>

        <footer class="alert__foot">
          <span>仅本地提示，不生成交易指令</span>
          <span>同一天同一规则只触发一次</span>
        </footer>
      </section>
    </div>
  )
}
