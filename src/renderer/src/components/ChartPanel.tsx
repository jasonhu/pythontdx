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
import { downloadText } from '../lib/download'
import { toCsv } from '@shared/csv'
import { appState, updateSettings } from '../stores/app'
import { normalizeMaPeriods } from '@shared/ma'
import type { KLineRangeStats } from '../lib/chart-geometry'
import { toneOf } from '../lib/tone'
import { KLineChart } from './KLineChart'
import { ChartSkeleton } from './ChartSkeleton'
import { TrendChart, type TrendHover } from './TrendChart'
import { IconRefresh } from './Icons'
import { IndicatorSubchart, type SubIndicator } from './IndicatorSubchart'
import type { DrawingMode } from './KLineChart'

type Tab = 'minute' | 'five' | KLinePeriod

/** 统一成两种渲染模式：折线（分时/五日）与蜡烛（K 线） */
type ChartData = { kind: 'trend'; days: MinuteTrend[] } | { kind: 'kline'; series: KLineSeries }

const TABS: { key: Tab; label: string }[] = [
  { key: 'minute', label: '分时' },
  { key: 'five', label: '五日' },
  { key: 'day', label: '日K' },
  { key: 'week', label: '周K' },
  { key: 'month', label: '月K' },
  { key: 'quarter', label: '季K' },
  { key: 'year', label: '年K' }
]

const MINUTE_PERIODS: KLinePeriod[] = ['5s', '15s', '1m', '5m', '10m', '15m', '20m', '30m', '60m']

const EXT_PERIODS: Array<[KLinePeriod, string]> = [
  ['2m', '2分'],
  ['3m', '3分'],
  ['4m', '4分'],
  ['6m', '6分'],
  ['8m', '8分'],
  ['12m', '12分'],
  ['18m', '18分'],
  ['24m', '24分'],
  ['36m', '36分'],
  ['48m', '48分'],
  ['2d', '2日'],
  ['3d', '3日'],
  ['4d', '4日'],
  ['6d', '6日'],
  ['9d', '9日'],
  ['12d', '12日'],
  ['18d', '18日'],
  ['24d', '24日'],
  ['45d', '45日']
]

const MA_COLORS = ['#f0b429', '#5b8cff', '#c084fc', '#22d3ee', '#f472b6'] as const

const maLegend = (): Array<{ label: string; color: string }> =>
  normalizeMaPeriods(appState.settings.maPeriods).map((period, index) => ({
    label: `MA${period}`,
    color: MA_COLORS[index] ?? MA_COLORS[0]
  }))

/** 折线类图表的自动刷新周期（主进程还有 10~60 秒缓存兜底） */
const REFRESH_MS = 30_000
/** K 线取多少根 —— 与缩放的最大档位一致：不可能显示比拉回来的更多 */
/** 一次请求 800 根历史：可见窗口最多 160 根，但均线用完整 800 根计算。 */
const KLINE_COUNT = 800

export interface ChartPanelProps {
  code: string
  onOpenReplay: () => void
  onOpenFormula: () => void
  onOpenIndicators: () => void
  focusMode?: boolean
  onToggleFocus?: () => void
  /** 独立窗口：隐藏会打开模态框/主窗口交互的按钮 */
  detached?: boolean
}

export function ChartPanel(props: ChartPanelProps): JSX.Element {
  const [tab, setTab] = createSignal<Tab>(appState.settings.chartTab ?? 'minute')
  const [adjust, setAdjust] = createSignal<KLineAdjust>(appState.settings.klineAdjust ?? 'qfq')
  const [showBoll, setShowBoll] = createSignal(appState.settings.showBoll ?? false)
  const [subIndicator, setSubIndicator] = createSignal<'none' | SubIndicator>(
    appState.settings.subIndicator ?? 'none'
  )
  const [logScale, setLogScale] = createSignal(appState.settings.logScale ?? false)
  const [rangeMode, setRangeMode] = createSignal(false)
  const [rangeStats, setRangeStats] = createSignal<KLineRangeStats | null>(null)
  const [drawMode, setDrawMode] = createSignal<DrawingMode>('none')
  const [drawingText, setDrawingText] = createSignal('标注')
  const [clearDrawingsKey, setClearDrawingsKey] = createSignal(0)
  const [pinned, setPinned] = createSignal(false)
  const [dividends, setDividends] = createSignal<Array<{ date: string; label: string }>>([])

  // 首屏可能在 state 落盘读取完成前创建，设置到达后再同步一次
  createEffect(() => {
    const savedTab = appState.settings.chartTab
    if (savedTab && savedTab !== tab()) setTab(savedTab)
  })
  createEffect(() => {
    const savedAdjust = appState.settings.klineAdjust
    if (savedAdjust && savedAdjust !== adjust()) setAdjust(savedAdjust)
  })
  createEffect(() => {
    const savedBoll = appState.settings.showBoll
    if (savedBoll !== undefined && savedBoll !== showBoll()) setShowBoll(savedBoll)
  })
  createEffect(() => {
    const saved = appState.settings.subIndicator
    if (saved && saved !== subIndicator()) setSubIndicator(saved)
  })
  createEffect(() => {
    const saved = appState.settings.logScale
    if (saved !== undefined && saved !== logScale()) setLogScale(saved)
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
  const exportSeries = (): void => {
    const series = klineSeries()
    if (series) {
      downloadText(
        `stocklens-${props.code}-${series.period}.csv`,
        toCsv(
          ['日期', '开盘', '最高', '最低', '收盘', '成交量(手)'],
          series.bars.map((bar) => [bar.date, bar.open, bar.high, bar.low, bar.close, bar.volume])
        )
      )
      return
    }
    const days = trendDays()
    if (!days) return
    const rows = days.flatMap((day) =>
      day.points.map((point) => [day.date, point.time, point.price, point.avg, point.volume])
    )
    downloadText(
      `stocklens-${props.code}-${tab()}.csv`,
      toCsv(['日期', '时间', '价格', '均价', '成交量(手)'], rows)
    )
  }

  createEffect(() => {
    const code = props.code
    void api.f10
      .dividend(code)
      .then((table) => {
        const dateIndex = table.columns.indexOf('除权派息日')
        const planIndex = table.columns.indexOf('分红方案')
        if (dateIndex < 0) {
          setDividends([])
          return
        }
        setDividends(
          table.rows
            .map((row) => ({
              date: String(row[dateIndex] ?? ''),
              label: String(planIndex >= 0 ? (row[planIndex] ?? '除权除息') : '除权除息')
            }))
            .filter((item) => /^\d{4}-\d{2}-\d{2}/.test(item.date))
        )
      })
      .catch(() => setDividends([]))
  })

  const switchTab = (next: Tab): void => {
    setHover(null)
    setTab(next)
    updateSettings({ chartTab: next })
  }

  return (
    <section class="card chart-card">
      <div class="chart-card__head">
        <div class="chart-toolbar chart-toolbar--primary">
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

          <Show when={!isTrend()}>
            <select
              class="chart-ext-select"
              value={EXT_PERIODS.some(([period]) => period === tab()) ? tab() : ''}
              aria-label="扩展周期"
              onChange={(event) => {
                const value = event.currentTarget.value
                if (value) switchTab(value as KLinePeriod)
              }}
            >
              <option value="">扩展</option>
              <For each={EXT_PERIODS}>
                {([period, label]) => <option value={period}>{label}</option>}
              </For>
            </select>
          </Show>
        </div>

        <div class="chart-toolbar chart-toolbar--secondary">
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

          <Show when={!isTrend()}>
            <button
              class="chip chart-boll"
              data-active={showBoll()}
              onClick={() => {
                const next = !showBoll()
                setShowBoll(next)
                updateSettings({ showBoll: next })
              }}
            >
              BOLL
            </button>
          </Show>

          <Show when={!isTrend()}>
            <button
              class="chip chart-log"
              data-active={logScale()}
              onClick={() => {
                const next = !logScale()
                setLogScale(next)
                updateSettings({ logScale: next })
              }}
            >
              {logScale() ? '对数' : '线性'}
            </button>
          </Show>

          <Show when={!isTrend()}>
            <button
              class="chip chart-draw-horizontal"
              data-active={drawMode() === 'horizontal'}
              title="点击图表放置水平线"
              onClick={() => setDrawMode((mode) => (mode === 'horizontal' ? 'none' : 'horizontal'))}
            >
              水平
            </button>
            <button
              class="chip chart-draw-vertical"
              data-active={drawMode() === 'vertical'}
              title="点击图表放置垂直线"
              onClick={() => setDrawMode((mode) => (mode === 'vertical' ? 'none' : 'vertical'))}
            >
              垂线
            </button>
            <button
              class="chip chart-draw-text"
              data-active={drawMode() === 'text'}
              title="输入文字后点击图表放置标注"
              onClick={() => setDrawMode((mode) => (mode === 'text' ? 'none' : 'text'))}
            >
              文字
            </button>
            <button
              class="chip chart-draw-trend"
              data-active={drawMode() === 'trend'}
              title="点两下画趋势线"
              onClick={() => setDrawMode((mode) => (mode === 'trend' ? 'none' : 'trend'))}
            >
              趋势
            </button>
            <button
              class="chip chart-draw-clear"
              title="清除所有画线"
              onClick={() => setClearDrawingsKey((value) => value + 1)}
            >
              清线
            </button>
            <Show when={drawMode() === 'text'}>
              <input
                class="chart-draw-text-input"
                value={drawingText()}
                maxlength="20"
                placeholder="标注文字"
                aria-label="标注文字"
                onInput={(event) => setDrawingText(event.currentTarget.value)}
              />
            </Show>
          </Show>

          <Show when={!isTrend()}>
            <button
              class="chip chart-range-toggle"
              data-active={rangeMode()}
              onClick={() => {
                const next = !rangeMode()
                setRangeMode(next)
                if (!next) setRangeStats(null)
              }}
            >
              区间
            </button>
          </Show>

          <Show when={!isTrend()}>
            <select
              class="chart-sub-select"
              value={subIndicator()}
              aria-label="K 线副图"
              onChange={(event) => {
                const value = event.currentTarget.value as 'none' | SubIndicator
                setSubIndicator(value)
                updateSettings({ subIndicator: value })
              }}
            >
              <option value="none">副图</option>
              <option value="macd">MACD</option>
              <option value="kdj">KDJ</option>
              <option value="rsi">RSI</option>
              <option value="wr">WR</option>
              <option value="cci">CCI</option>
              <option value="bias">BIAS</option>
              <option value="dmi">DMI</option>
              <option value="obv">OBV</option>
            </select>
          </Show>

          <Show when={!isTrend() && klineSeries()?.source === 'cache'}>
            <span class="chart-cache-badge" title={klineSeries()?.cachePath ?? '本地缓存'}>
              离线缓存
            </span>
          </Show>

          {/* 十字光标联动读数：有悬浮时显示读数，否则显示图例 */}
          <div class="chart-headline">
            <Show when={hover()}>
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

            <Show when={!props.detached}>
              <button
                class="btn btn--bare indicator-open"
                title="技术指标"
                onClick={() => props.onOpenIndicators()}
              >
                指标
              </button>
              <button
                class="btn btn--bare formula-open"
                title="指标公式预览"
                onClick={() => props.onOpenFormula()}
              >
                公式
              </button>
              <Show when={appState.settings.mainFormula}>
                <button
                  class="btn btn--bare chart-formula-clear"
                  title={`清除主图公式：${appState.settings.mainFormula}`}
                  onClick={() => updateSettings({ mainFormula: undefined })}
                >
                  清公式
                </button>
              </Show>
              <button
                class="btn btn--bare replay-open"
                title="日 K 复盘"
                onClick={() => props.onOpenReplay()}
              >
                复盘
              </button>
              <button
                class="btn btn--bare chart-focus"
                title="专注模式：隐藏左右栏（F 切换，Esc 退出）"
                onClick={() => props.onToggleFocus?.()}
              >
                {props.focusMode ? '退出专注' : '专注'}
              </button>
              <button
                class="btn btn--bare chart-pin"
                title="当前窗口置顶（再次点击取消）"
                data-active={pinned()}
                onClick={() => void api.window.toggleAlwaysOnTop().then(setPinned)}
              >
                {pinned() ? '取消置顶' : '置顶'}
              </button>
              <button
                class="btn btn--bare chart-export"
                title="导出当前图表 CSV"
                onClick={exportSeries}
              >
                导出
              </button>
              <button
                class="btn btn--bare chart-detach"
                title="在新窗口打开"
                onClick={() => void api.window.openChart(props.code)}
              >
                新窗
              </button>
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
      </div>

      <Show when={rangeMode() || rangeStats()}>
        <div class="chart-range-stats">
          <Show when={rangeStats()} fallback={<span>区间统计：在图上点两下选择起点/终点</span>}>
            {(stats) => (
              <>
                <span class="chart-range-stats__title">区间 {stats().bars} 根</span>
                <span>
                  涨跌{' '}
                  <strong
                    classList={{
                      'tone-up': stats().changePct > 0,
                      'tone-down': stats().changePct < 0
                    }}
                  >
                    {signedPct(stats().changePct)}
                  </strong>
                </span>
                <span>最高 {fixed(stats().high)}</span>
                <span>最低 {fixed(stats().low)}</span>
                <span>振幅 {fixed(stats().amplitude)}%</span>
                <span>量 {thousands(stats().volume)} 手</span>
              </>
            )}
          </Show>
        </div>
      </Show>

      <div
        class="chart-card__body"
        classList={{
          'chart-card__body--sub': subIndicator() !== 'none' && klineSeries() !== undefined
        }}
      >
        <div class="chart-ma-overlay" classList={{ 'chart-ma-overlay--hidden': hover() !== null }}>
          <Show
            when={isTrend()}
            fallback={
              <For each={maLegend()}>
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
          </Show>
        </div>
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
              <Show when={klineSeries()}>
                {(series) => (
                  <KLineChart
                    series={series()}
                    boll={showBoll()}
                    logScale={logScale()}
                    rangeMode={rangeMode()}
                    onRangeStats={setRangeStats}
                    drawMode={drawMode()}
                    overlayFormula={appState.settings.mainFormula}
                    dividends={dividends()}
                    clearDrawingsKey={clearDrawingsKey()}
                  />
                )}
              </Show>
              <Show when={subIndicator() !== 'none' ? klineSeries() : undefined}>
                {(series) => (
                  <IndicatorSubchart bars={series().bars} kind={subIndicator() as SubIndicator} />
                )}
              </Show>
            </Show>
          </Show>
        </Show>
      </div>
    </section>
  )
}
