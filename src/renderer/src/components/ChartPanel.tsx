/**
 * 图表卡片：分时 / 日K / 周K / 月K 切换 + 数据加载与自动刷新。
 */
import { createMemo, createResource, createSignal, For, onCleanup, Show, type JSX } from 'solid-js'
import type { KLinePeriod, KLineSeries, MinuteTrend } from '@shared/types'
import { api, errorMessage } from '../lib/ipc'
import { KLineChart } from './KLineChart'
import { TrendChart } from './TrendChart'
import { IconRefresh } from './Icons'

type Tab = 'minute' | KLinePeriod

type ChartData = { kind: 'minute'; trend: MinuteTrend } | { kind: 'kline'; series: KLineSeries }

const TABS: { key: Tab; label: string }[] = [
  { key: 'minute', label: '分时' },
  { key: 'day', label: '日K' },
  { key: 'week', label: '周K' },
  { key: 'month', label: '月K' }
]

/** 分时图的自动刷新周期（主进程还有 10 秒缓存兜底） */
const MINUTE_REFRESH_MS = 30_000
/** K 线取多少根 */
const KLINE_COUNT = 160

export interface ChartPanelProps {
  code: string
}

export function ChartPanel(props: ChartPanelProps): JSX.Element {
  const [tab, setTab] = createSignal<Tab>('minute')
  const [tick, setTick] = createSignal(0)

  /**
   * 用 memo 把 code 稳定下来。
   *
   * props.code 本身是响应式 getter，而父组件每 3 秒就会推来一个新的 quote 对象，
   * 直接读 props.code 会让 createResource 的 source 每次都「看起来变了」，
   * 导致图表每 3 秒重新拉一次数据。memo 默认做值比较，字符串没变就不会向下游传播。
   */
  const code = createMemo(() => props.code)

  const timer = setInterval(() => setTick((value) => value + 1), MINUTE_REFRESH_MS)
  onCleanup(() => clearInterval(timer))

  const [data, { refetch }] = createResource<ChartData, { code: string; tab: Tab; tick: number }>(
    () => ({ code: code(), tab: tab(), tick: tab() === 'minute' ? tick() : 0 }),
    async (source) => {
      if (source.tab === 'minute') {
        return { kind: 'minute', trend: await api.trend.minute(source.code) }
      }
      return {
        kind: 'kline',
        series: await api.trend.kline({
          code: source.code,
          period: source.tab,
          count: KLINE_COUNT
        })
      }
    }
  )

  const minuteTrend = (): MinuteTrend | undefined => {
    const current = data()
    return current?.kind === 'minute' ? current.trend : undefined
  }

  const klineSeries = (): KLineSeries | undefined => {
    const current = data()
    return current?.kind === 'kline' ? current.series : undefined
  }

  const isEmpty = (): boolean => {
    if (data.loading || data.error) return false
    const current = data()
    if (!current) return false
    return current.kind === 'minute'
      ? current.trend.points.length === 0
      : current.series.bars.length === 0
  }

  return (
    <section class="card chart-card">
      <div class="chart-card__head">
        <div class="segmented">
          <For each={TABS}>
            {(item) => (
              <button
                class="segmented__item"
                data-active={tab() === item.key}
                onClick={() => setTab(item.key)}
              >
                {item.label}
              </button>
            )}
          </For>
        </div>

        <div class="chart-legend">
          <Show
            when={tab() === 'minute'}
            fallback={
              <For
                each={[
                  { label: 'MA5', color: '#f0b429' },
                  { label: 'MA10', color: '#5b8cff' },
                  { label: 'MA20', color: '#c084fc' }
                ]}
              >
                {(item) => (
                  <span class="chart-legend__item">
                    <span class="chart-legend__swatch" style={{ background: item.color }} />
                    {item.label}
                  </span>
                )}
              </For>
            }
          >
            <span class="chart-legend__item">
              <span class="chart-legend__swatch" style={{ background: 'var(--up-line)' }} />
              价格
            </span>
            <span class="chart-legend__item">
              <span class="chart-legend__swatch" style={{ background: 'var(--chart-avg)' }} />
              均价
            </span>
          </Show>

          <button
            class="btn btn--icon btn--bare"
            title="刷新图表数据"
            onClick={() => void refetch()}
          >
            <IconRefresh size={13} />
          </button>
        </div>
      </div>

      <div class="chart-card__body">
        <Show
          when={!data.error}
          fallback={
            <div class="chart-empty">
              <div style={{ display: 'grid', gap: '10px', 'place-items': 'center' }}>
                <span style={{ color: 'var(--up)' }}>{errorMessage(data.error)}</span>
                <button class="btn" onClick={() => void refetch()}>
                  <IconRefresh size={12} />
                  重新加载
                </button>
              </div>
            </div>
          }
        >
          <Show
            when={!isEmpty()}
            fallback={<div class="chart-empty">暂无行情数据（可能停牌或尚未开盘）</div>}
          >
            <Show when={minuteTrend()}>{(trend) => <TrendChart trend={trend()} />}</Show>
            <Show when={klineSeries()}>{(series) => <KLineChart series={series()} />}</Show>
          </Show>
        </Show>
      </div>
    </section>
  )
}
