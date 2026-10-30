/**
 * 图表卡片：分时 / 五日 / 日K / 周K / 月K 切换 + 数据加载与自动刷新。
 *
 * 标题区还有一个「十字光标联动读数」：鼠标在图上移动时，
 * 图例会被替换成当前光标位置的 时间 / 价格 / 涨跌幅 / 均价 / 成交量，
 * 移开后又变回图例。这是专业行情软件的标配交互。
 */
import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  For,
  onCleanup,
  Show,
  type JSX
} from 'solid-js'
import type { KLineAdjust, KLinePeriod, KLineSeries, MinuteTrend } from '@shared/types'
import { fixed, signedPct, thousands } from '@shared/format'
import { api, errorMessage } from '../lib/ipc'
import { appState, updateSettings } from '../stores/app'
import { KLINE_BARS_MAX } from '../lib/chart-geometry'
import { toneOf } from '../lib/tone'
import { KLineChart } from './KLineChart'
import { ChartSkeleton } from './ChartSkeleton'
import { TrendChart, type TrendHover } from './TrendChart'
import { IconRefresh } from './Icons'

type Tab = 'minute' | 'five' | KLinePeriod

/** 统一成两种渲染模式：折线（分时/五日）与蜡烛（K 线） */
type ChartData = { kind: 'trend'; days: MinuteTrend[] } | { kind: 'kline'; series: KLineSeries }

const TABS: { key: Tab; label: string }[] = [
  { key: 'minute', label: '分时' },
  { key: 'five', label: '五日' },
  { key: 'day', label: '日K' },
  { key: 'week', label: '周K' },
  { key: 'month', label: '月K' }
]

const MINUTE_PERIODS: KLinePeriod[] = ['5s', '15s', '1m', '5m', '15m', '30m', '60m']

const MA_LEGEND = [
  { label: 'MA5', color: '#f0b429' },
  { label: 'MA10', color: '#5b8cff' },
  { label: 'MA20', color: '#c084fc' }
]

/** 折线类图表的自动刷新周期（主进程还有 10~60 秒缓存兜底） */
const REFRESH_MS = 30_000
/** K 线取多少根 —— 与缩放的最大档位一致：不可能显示比拉回来的更多 */
const KLINE_COUNT = KLINE_BARS_MAX

export interface ChartPanelProps {
  code: string
  onOpenReplay: () => void
  onOpenFormula: () => void
}

export function ChartPanel(props: ChartPanelProps): JSX.Element {
  const [tab, setTab] = createSignal<Tab>(appState.settings.chartTab ?? 'minute')
  const [adjust, setAdjust] = createSignal<KLineAdjust>(appState.settings.klineAdjust ?? 'qfq')

  // 首屏可能在 state 落盘读取完成前创建，设置到达后再同步一次
  createEffect(() => {
    const savedTab = appState.settings.chartTab
    if (savedTab && savedTab !== tab()) setTab(savedTab)
  })
  createEffect(() => {
    const savedAdjust = appState.settings.klineAdjust
    if (savedAdjust && savedAdjust !== adjust()) setAdjust(savedAdjust)
  })
  const [tick, setTick] = createSignal(0)
  const [hover, setHover] = createSignal<TrendHover | null>(null)

  /**
   * 用 memo 把 code 稳定下来。
   *
   * props.code 本身是响应式 getter，而父组件每 3 秒就会推来一个新的 quote 对象，
   * 直接读 props.code 会让 createResource 的 source 每次都「看起来变了」，
   * 导致图表每 3 秒重新拉一次数据。memo 默认做值比较，字符串没变就不会向下游传播。
   */
  const code = createMemo(() => props.code)
  const isTrend = (): boolean => tab() === 'minute' || tab() === 'five'

  const timer = setInterval(() => setTick((value) => value + 1), REFRESH_MS)
  onCleanup(() => clearInterval(timer))

  const [data, { refetch }] = createResource<
    ChartData,
    { code: string; tab: Tab; tick: number; adjust: KLineAdjust }
  >(
    () => ({ code: code(), tab: tab(), tick: isTrend() ? tick() : 0, adjust: adjust() }),
    async (source) => {
      if (source.tab === 'five') {
        const multi = await api.trend.fiveDay(source.code)
        return { kind: 'trend', days: multi.days }
      }
      if (source.tab === 'minute') {
        const trend = await api.trend.minute(source.code)
        return { kind: 'trend', days: [trend] }
      }
      return {
        kind: 'kline',
        series: await api.trend.kline({
          code: source.code,
          period: source.tab,
          count: KLINE_COUNT,
          adjust: source.adjust
        })
      }
    }
  )

  const trendDays = (): MinuteTrend[] | undefined => {
    const current = data()
    return current?.kind === 'trend' ? current.days : undefined
  }

  const klineSeries = (): KLineSeries | undefined => {
    const current = data()
    return current?.kind === 'kline' ? current.series : undefined
  }

  const isEmpty = (): boolean => {
    if (data.loading || data.error) return false
    const current = data()
    if (!current) return false
    if (current.kind === 'kline') return current.series.bars.length === 0
    return current.days.every((day) => day.points.length === 0)
  }

  /** 切 tab 或切股票时清掉残留的读数，避免显示上一只票的数值 */
  const switchTab = (next: Tab): void => {
    setHover(null)
    setTab(next)
    updateSettings({ chartTab: next })
  }

  return (
    <section class="card chart-card">
      <div class="chart-card__head">
        <div class="segmented">
          <For each={TABS}>
            {(item) => (
              <button
                class={`segmented__item chart-tab-${item.key}`}
                data-active={tab() === item.key}
                onClick={() => switchTab(item.key)}
              >
                {item.label}
              </button>
            )}
          </For>
        </div>

        <Show when={!isTrend()}>
          <div class="chart-adjust-group">
            <For
              each={[
                { value: 'none' as KLineAdjust, label: '不复权' },
                { value: 'qfq' as KLineAdjust, label: '前复权' },
                { value: 'hfq' as KLineAdjust, label: '后复权' }
              ]}
            >
              {(item) => (
                <button
                  class={`chip chart-adjust chart-adjust--${item.value}`}
                  data-active={adjust() === item.value}
                  onClick={() => {
                    setAdjust(item.value)
                    updateSettings({ klineAdjust: item.value })
                    setHover(null)
                  }}
                >
                  {item.label}
                </button>
              )}
            </For>
          </div>
        </Show>

        <div class="chart-minute-tabs" aria-label="分钟 K 周期">
          <For each={MINUTE_PERIODS}>
            {(period) => (
              <button
                class={`chart-minute-tab chart-tab-${period}`}
                data-active={tab() === period}
                title={period.endsWith('s') ? period : `${period.replace('m', '')} 分钟 K`}
                onClick={() => switchTab(period)}
              >
                {period.endsWith('s') ? period : period.replace('m', '')}
              </button>
            )}
          </For>
        </div>

        {/* 十字光标联动读数：有悬浮时显示读数，否则显示图例 */}
        <div class="chart-headline">
          <Show
            when={hover()}
            fallback={
              <div class="chart-legend">
                <Show
                  when={isTrend()}
                  fallback={
                    <For each={MA_LEGEND}>
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
                    <span class="chart-legend__swatch" style={{ background: 'var(--accent)' }} />
                    价格
                  </span>
                  <span class="chart-legend__item">
                    <span class="chart-legend__swatch" style={{ background: 'var(--chart-avg)' }} />
                    均价
                  </span>
                  <Show when={tab() === 'five'}>
                    <span class="chart-legend__item">每段一个交易日</span>
                  </Show>
                </Show>
              </div>
            }
          >
            {(current) => (
              <div class="chart-readout">
                <span class="chart-readout__time num">{current().label}</span>
                <span
                  class="chart-readout__price num"
                  style={{ color: `var(--${toneOf(current().changePct)})` }}
                >
                  {fixed(current().price)}
                </span>
                <span
                  class="chart-readout__pct num"
                  style={{ color: `var(--${toneOf(current().changePct)})` }}
                >
                  {signedPct(current().changePct)}
                </span>
                <span class="chart-readout__item">
                  均价 <b class="num">{fixed(current().avg)}</b>
                </span>
                <span class="chart-readout__item">
                  量 <b class="num">{thousands(current().volume)}</b> 手
                </span>
              </div>
            )}
          </Show>

          <button
            class="btn btn--bare formula-open"
            title="指标公式预览"
            onClick={() => props.onOpenFormula()}
          >
            公式
          </button>
          <button
            class="btn btn--bare replay-open"
            title="日 K 复盘"
            onClick={() => props.onOpenReplay()}
          >
            复盘
          </button>
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
          {/*
            首屏加载时给骨架屏；已经有数据时再刷新（data() 仍是旧值）就继续显示图表，
            避免每次定时刷新都闪一下白。
          */}
          <Show when={!data.loading || data()} fallback={<ChartSkeleton />}>
            <Show
              when={!isEmpty()}
              fallback={<div class="chart-empty">暂无行情数据（可能停牌或尚未开盘）</div>}
            >
              <Show when={trendDays()}>
                {(days) => <TrendChart days={days()} onHover={setHover} />}
              </Show>
              <Show when={klineSeries()}>{(series) => <KLineChart series={series()} />}</Show>
            </Show>
          </Show>
        </Show>
      </div>
    </section>
  )
}
