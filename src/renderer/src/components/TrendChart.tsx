/**
 * 分时图（纯 SVG 手绘，零依赖）。支持 1 日与多日（五日分时）。
 *
 * 几个「像专业软件」的细节：
 *  1. 横轴按交易日固定分格：一天 241 个分钟点。盘中只画到当前时刻、
 *     右侧留白，而不是把已有数据拉伸铺满整个宽度；
 *  2. 单日时纵轴以昨收为中心上下对称，右轴同时给「价格」和「涨跌幅」两套刻度；
 *     多日时改用价格区间 + 好看的数字刻度，并按天分段上色；
 *  3. 下方叠一条成交量柱，颜色跟随该分钟的涨跌方向；
 *  4. 十字光标 + 浮层读数，并可通过 onHover 回调把读数抛给外部（标题区联动）。
 */
import { createEffect, createMemo, createSignal, For, on, Show, type JSX } from 'solid-js'
import type { MinutePoint, MinuteTrend } from '@shared/types'
import { fixed, minuteLabel, signed, signedPct } from '@shared/format'
import { useElementSize } from '../lib/dom'
import { toneOf, type Tone } from '../lib/tone'

const PAD = { top: 18, right: 64, bottom: 22, left: 10 }

/** 一个交易日的分时槽位数（09:30–11:30 + 13:01–15:00 共 241 个点，索引 0..240） */
const DAY_SLOTS = 241

/** 成交量区占绘图高度的比例 */
const VOLUME_RATIO = 0.2

/** 价格区与成交量区之间的留白 */
const GAP = 12

/** 悬浮读数：由 onHover 抛给外部，用于让卡片标题区跟着十字光标联动 */
export interface TrendHover {
  /** 单日显示 HH:MM，多日显示 MM-DD HH:MM */
  label: string
  price: number
  avg: number
  volume: number
  change: number
  changePct: number
}

export interface TrendChartProps {
  /** 从旧到新排列的交易日；单日分时传一个元素即可 */
  days: MinuteTrend[]
  onHover?: (hover: TrendHover | null) => void
}

/** 摊平后的一个绘图点 */
interface FlatPoint {
  point: MinutePoint
  dayIndex: number
  /** 该点在整条横轴上的槽位 */
  slot: number
}

export function TrendChart(props: TrendChartProps): JSX.Element {
  const { size, ref } = useElementSize<HTMLDivElement>()
  const [hoverSlot, setHoverSlot] = createSignal<number | null>(null)

  const days = (): MinuteTrend[] => props.days
  const isMultiDay = (): boolean => days().length > 1

  /** 所有交易日的点按时间顺序摊平成一维 */
  const flat = createMemo<FlatPoint[]>(() =>
    days().flatMap((day, dayIndex) =>
      day.points.map((point, pointIndex) => ({
        point,
        dayIndex,
        slot: dayIndex * DAY_SLOTS + pointIndex
      }))
    )
  )

  /** 最后一个交易日（单日模式下的基准来源） */
  const lastDay = (): MinuteTrend | undefined => days()[days().length - 1]

  const geometry = createMemo(() => {
    const { width, height } = size()
    const list = flat()
    if (width < 120 || height < 140 || list.length === 0) return null

    const plotW = width - PAD.left - PAD.right
    const plotH = height - PAD.top - PAD.bottom
    const volumeH = plotH * VOLUME_RATIO
    const priceH = plotH - volumeH - GAP
    const priceTop = PAD.top
    const priceBottom = priceTop + priceH
    const volumeTop = priceBottom + GAP
    const volumeBottom = volumeTop + volumeH
    const totalSlots = Math.max(1, days().length * DAY_SLOTS - 1)
    let yMin: number
    let yMax: number

    if (isMultiDay()) {
      // 多日：按全部交易日的真实价格区间取范围
      let low = Infinity
      let high = -Infinity
      for (const item of list) {
        low = Math.min(low, item.point.price, item.point.avg)
        high = Math.max(high, item.point.price, item.point.avg)
      }
      const padding = (high - low) * 0.06 || high * 0.01
      yMax = high + padding
      yMin = Math.max(0, low - padding)
    } else {
      // 单日：以昨收为中心上下对称，一眼看出偏离基准多少
      const baseline = lastDay()?.prevClose || list[0].point.price
      let deviation = 0
      for (const item of list) {
        deviation = Math.max(
          deviation,
          Math.abs(item.point.price - baseline),
          Math.abs(item.point.avg - baseline)
        )
      }
      if (deviation < baseline * 1e-4) deviation = baseline * 0.002
      // 只留 2% 余量：留太多会让折线挤在中间一条带里，浪费纵向空间
      const padding = deviation * 1.02
      yMax = baseline + padding
      yMin = baseline - padding
    }

    const maxVolume = Math.max(1, ...list.map((item) => item.point.volume))

    return {
      width,
      height,
      plotW,
      priceTop,
      priceBottom,
      volumeBottom,
      totalSlots,
      yMax,
      yMin,
      maxVolume,
      /*
       * 这里刻意在函数内部重新读一次 days()，而不是复用外层的 totalSlots。
       * 否则闭包捕获的是「创建那一刻」的快照，图表切换天数后横轴不会更新
       * ——ESLint 的 solid/reactivity 规则会直接把这种写法判为错误。
       */
      x: (slot: number) => PAD.left + (slot / Math.max(1, days().length * DAY_SLOTS - 1)) * plotW,
      yPrice: (value: number) => priceTop + ((yMax - value) / (yMax - yMin)) * priceH,
      yVolume: (value: number) => volumeBottom - (value / maxVolume) * volumeH
    }
  })

  /** 每个交易日一条折线，各自按当天的涨跌上色 */
  const dayPaths = createMemo(() => {
    const geo = geometry()
    if (!geo) return []
    return days().map((day, dayIndex) => {
      const tone: Tone = toneOf((day.points[day.points.length - 1]?.price ?? 0) - day.prevClose)
      const path = day.points
        .map((point, pointIndex) => {
          const x = geo.x(dayIndex * DAY_SLOTS + pointIndex)
          const y = geo.yPrice(point.price)
          return `${pointIndex === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`
        })
        .join(' ')
      const lastSlot = dayIndex * DAY_SLOTS + Math.max(0, day.points.length - 1)
      return {
        dayIndex,
        tone,
        path,
        color: toneColor(tone),
        area: path
          ? `${path} L${geo.x(lastSlot).toFixed(2)},${geo.priceBottom} L${geo.x(dayIndex * DAY_SLOTS).toFixed(2)},${geo.priceBottom} Z`
          : ''
      }
    })
  })

  /** 均价线：多日时用同一条虚线贯穿，避免五种颜色太花 */
  const avgPath = createMemo(() => {
    const geo = geometry()
    if (!geo) return ''
    return days()
      .flatMap((day, dayIndex) =>
        day.points.map((point, pointIndex) => {
          const x = geo.x(dayIndex * DAY_SLOTS + pointIndex)
          const y = geo.yPrice(point.avg)
          return `${pointIndex === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`
        })
      )
      .join(' ')
  })

  /** 纵轴刻度 */
  const levels = createMemo<{ value: number; pct: number | null }[]>(() => {
    const geo = geometry()
    if (!geo) return []

    if (isMultiDay()) {
      const step = niceStep(geo.yMax - geo.yMin, 5)
      const result: { value: number; pct: number | null }[] = []
      for (let value = Math.ceil(geo.yMin / step) * step; value <= geo.yMax; value += step) {
        result.push({ value: Number(value.toFixed(3)), pct: null })
      }
      return result
    }

    const base = lastDay()?.prevClose ?? geo.yMin
    const rangePct = ((geo.yMax - geo.yMin) / base) * 100
    const step =
      rangePct <= 2 ? 0.5 : rangePct <= 4 ? 1 : rangePct <= 9 ? 2 : rangePct <= 20 ? 5 : 10

    const result: { value: number; pct: number | null }[] = [{ value: base, pct: 0 }]
    for (let pct = step; pct <= rangePct / 2 + step; pct += step) {
      const up = base * (1 + pct / 100)
      const down = base * (1 - pct / 100)
      if (up < geo.yMax) result.push({ value: up, pct })
      if (down > geo.yMin) result.push({ value: down, pct: -pct })
    }
    return result.sort((a, b) => b.value - a.value)
  })

  /** 横轴标签：单日给时间刻，多日给每个交易日的日期 */
  const timeTicks = createMemo(() => {
    if (isMultiDay()) {
      return days().map((day, dayIndex) => ({
        slot: dayIndex * DAY_SLOTS,
        label: `${day.date.slice(4, 6)}-${day.date.slice(6, 8)}`,
        anchor: 'start' as const
      }))
    }
    return [
      { slot: 0, label: '09:30', anchor: 'start' as const },
      { slot: 60, label: '10:30', anchor: 'middle' as const },
      { slot: 120, label: '11:30/13:00', anchor: 'middle' as const },
      { slot: 180, label: '14:00', anchor: 'middle' as const },
      { slot: 240, label: '15:00', anchor: 'end' as const }
    ]
  })

  /** 交易日之间的分隔线（仅多日模式） */
  const separators = createMemo(() =>
    isMultiDay()
      ? days()
          .slice(1)
          .map((_, index) => (index + 1) * DAY_SLOTS)
      : []
  )

  const hovered = createMemo(() => {
    const slot = hoverSlot()
    const geo = geometry()
    if (slot === null || !geo) return null

    // 槽位 → (第几天, 第几个点)：每天的槽位连续，整除取余即可
    const dayIndex = Math.min(days().length - 1, Math.max(0, Math.floor(slot / DAY_SLOTS)))
    const day = days()[dayIndex]
    if (!day || day.points.length === 0) return null

    const pointIndex = Math.min(
      day.points.length - 1,
      Math.max(0, Math.round(slot - dayIndex * DAY_SLOTS))
    )
    const point = day.points[pointIndex]

    return {
      point,
      x: geo.x(dayIndex * DAY_SLOTS + pointIndex),
      y: geo.yPrice(point.price),
      change: point.price - day.prevClose,
      changePct: day.prevClose > 0 ? ((point.price - day.prevClose) / day.prevClose) * 100 : 0,
      label: isMultiDay()
        ? `${day.date.slice(4, 6)}-${day.date.slice(6, 8)} ${minuteLabel(point.time)}`
        : minuteLabel(point.time)
    }
  })

  /*
   * 把悬浮读数抛给外部（卡片标题区联动）。
   * 用 createEffect + on(hovered, ...) 而不是裸 createMemo：
   * 前者只在 hovered 真的变化时才执行副作用，后者是「用 memo 做副作用」的坏味道。
   */
  createEffect(
    on(hovered, (current) => {
      props.onHover?.(
        current
          ? {
              label: current.label,
              price: current.point.price,
              avg: current.point.avg,
              volume: current.point.volume,
              change: current.change,
              changePct: current.changePct
            }
          : null
      )
    })
  )

  const onPointerMove = (event: PointerEvent): void => {
    const geo = geometry()
    if (!geo || flat().length === 0) return
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
    const ratio = (event.clientX - rect.left - PAD.left) / geo.plotW
    setHoverSlot(Math.round(ratio * geo.totalSlots))
  }

  const clearHover = (): void => {
    setHoverSlot(null)
    props.onHover?.(null)
  }

  return (
    <div class="chart-host" ref={ref} onPointerMove={onPointerMove} onPointerLeave={clearHover}>
      <Show when={geometry()} fallback={<div class="chart-empty">正在加载分时数据…</div>}>
        {(geo) => (
          <svg class="chart-svg" width={geo().width} height={geo().height}>
            <defs>
              <linearGradient
                id="trend-area"
                gradientUnits="userSpaceOnUse"
                x1="0"
                y1={geo().priceTop}
                x2="0"
                y2={geo().priceBottom}
              >
                <stop offset="0%" stop-color="var(--accent)" stop-opacity="0.24" />
                <stop offset="100%" stop-color="var(--accent)" stop-opacity="0" />
              </linearGradient>
            </defs>

            {/* ---------- 交易日分隔线 ---------- */}
            <For each={separators()}>
              {(slot) => (
                <line
                  x1={geo().x(slot)}
                  x2={geo().x(slot)}
                  y1={geo().priceTop}
                  y2={geo().volumeBottom}
                  stroke="var(--border-strong)"
                />
              )}
            </For>

            {/* ---------- 纵向时间网格 ---------- */}
            <For each={timeTicks()}>
              {(tick) => (
                <line
                  x1={geo().x(tick.slot)}
                  x2={geo().x(tick.slot)}
                  y1={geo().priceTop}
                  y2={geo().volumeBottom}
                  stroke="var(--chart-grid)"
                />
              )}
            </For>

            {/* ---------- 横向价格网格 + 右轴刻度 ---------- */}
            <For each={levels()}>
              {(level) => {
                const y = (): number => geo().yPrice(level.value)
                return (
                  <g>
                    <line
                      x1={PAD.left}
                      x2={geo().width - PAD.right}
                      y1={y()}
                      y2={y()}
                      stroke="var(--chart-grid)"
                      stroke-dasharray={level.pct === 0 ? undefined : '3 5'}
                    />
                    <text
                      x={geo().width - PAD.right + 8}
                      y={y() + 3.5}
                      fill={level.pct === 0 ? 'var(--text-3)' : 'var(--chart-axis)'}
                      font-size="10"
                      class="num"
                    >
                      {fixed(level.value, 2)}
                    </text>
                    <Show when={level.pct !== null}>
                      <text
                        x={geo().width - PAD.right + 8}
                        y={y() + 14}
                        fill="var(--text-3)"
                        font-size="9"
                        class="num"
                      >
                        {level.pct === 0 ? '0.00%' : signedPct(level.pct)}
                      </text>
                    </Show>
                  </g>
                )
              }}
            </For>

            {/* ---------- 成交量柱 ---------- */}
            <For each={flat()}>
              {(item, index) => {
                const previousPrice = (): number => {
                  if (index() === 0) return days()[0]?.prevClose ?? item.point.price
                  return flat()[index() - 1].point.price
                }
                const width = (): number => barWidth(geo().plotW, geo().totalSlots)
                return (
                  <rect
                    x={geo().x(item.slot) - width() / 2}
                    y={geo().yVolume(item.point.volume)}
                    width={width()}
                    height={Math.max(0, geo().volumeBottom - geo().yVolume(item.point.volume))}
                    fill={item.point.price >= previousPrice() ? 'var(--up)' : 'var(--down)'}
                    opacity="0.55"
                  />
                )
              }}
            </For>

            {/* ---------- 面积 + 每日折线 ---------- */}
            <For each={dayPaths()}>
              {(day) => (
                <g>
                  <path d={day.area} fill="url(#trend-area)" />
                  <path
                    d={day.path}
                    fill="none"
                    stroke={day.color}
                    stroke-width="1.6"
                    stroke-linejoin="round"
                    stroke-linecap="round"
                  />
                </g>
              )}
            </For>

            <path
              d={avgPath()}
              fill="none"
              stroke="var(--chart-avg)"
              stroke-width="1.1"
              stroke-dasharray="4 3"
              opacity="0.9"
            />

            {/* ---------- 横轴标签 ---------- */}
            <For each={timeTicks()}>
              {(tick) => (
                <text
                  x={geo().x(tick.slot)}
                  y={geo().height - 6}
                  fill="var(--text-3)"
                  font-size="10"
                  text-anchor={tick.anchor}
                >
                  {tick.label}
                </text>
              )}
            </For>

            {/* ---------- 十字光标 ---------- */}
            <Show when={hovered()}>
              {(current) => (
                <g>
                  <line
                    x1={current().x}
                    x2={current().x}
                    y1={geo().priceTop}
                    y2={geo().volumeBottom}
                    stroke="var(--chart-crosshair)"
                    stroke-dasharray="3 3"
                  />
                  <line
                    x1={PAD.left}
                    x2={geo().width - PAD.right}
                    y1={current().y}
                    y2={current().y}
                    stroke="var(--chart-crosshair)"
                    stroke-dasharray="3 3"
                  />
                  <circle
                    cx={current().x}
                    cy={current().y}
                    r="3.4"
                    fill="var(--panel-solid)"
                    stroke={toneColor(toneOf(current().change))}
                    stroke-width="1.6"
                  />
                </g>
              )}
            </Show>
          </svg>
        )}
      </Show>

      {/* ---------- 浮层读数 ---------- */}
      <Show when={hovered()}>
        {(current) => (
          <div
            class="chart-tooltip"
            style={{
              left: `${Math.min(current().x + 14, Math.max(0, size().width - 160))}px`,
              top: '10px'
            }}
          >
            <div class="chart-tooltip__row">
              <span class="chart-tooltip__label">时间</span>
              <span class="num">{current().label}</span>
            </div>
            <div class="chart-tooltip__row">
              <span class="chart-tooltip__label">价格</span>
              <span class="num" style={{ color: toneColor(toneOf(current().change)) }}>
                {fixed(current().point.price)}
              </span>
            </div>
            <div class="chart-tooltip__row">
              <span class="chart-tooltip__label">涨跌幅</span>
              <span class="num" style={{ color: toneColor(toneOf(current().change)) }}>
                {signedPct(current().changePct)}
              </span>
            </div>
            <div class="chart-tooltip__row">
              <span class="chart-tooltip__label">涨跌额</span>
              <span class="num">{signed(current().change)}</span>
            </div>
            <div class="chart-tooltip__row">
              <span class="chart-tooltip__label">均价</span>
              <span class="num" style={{ color: 'var(--chart-avg)' }}>
                {fixed(current().point.avg)}
              </span>
            </div>
            <div class="chart-tooltip__row">
              <span class="chart-tooltip__label">成交量</span>
              <span class="num">{current().point.volume.toFixed(0)} 手</span>
            </div>
          </div>
        )}
      </Show>
    </div>
  )
}

/* ------------------------------------------------------------ 纯函数工具 */

function toneColor(tone: Tone): string {
  if (tone === 'up') return 'var(--up-line)'
  if (tone === 'down') return 'var(--down-line)'
  return 'var(--flat)'
}

/** 成交量柱宽度：按槽位数均分后取 64%，并保底 1px */
function barWidth(plotW: number, totalSlots: number): number {
  return Math.max(1, (plotW / (totalSlots + 1)) * 0.64)
}

/** 取一个「好看」的刻度步长：1 / 2 / 5 × 10ⁿ */
function niceStep(range: number, targetTicks: number): number {
  const raw = range / targetTicks
  if (!Number.isFinite(raw) || raw <= 0) return 1
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)))
  const normalized = raw / magnitude
  const step = normalized >= 5 ? 10 : normalized >= 2 ? 5 : normalized >= 1 ? 2 : 1
  return step * magnitude
}
