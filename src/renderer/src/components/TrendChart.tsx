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
 *
 * 所有的坐标换算都在 `lib/chart-geometry.ts` 里，那部分是纯函数且有单元测试。
 * 本组件只负责「把返回的数字画出来」。
 */
import { createEffect, createMemo, createSignal, For, on, Show, type JSX } from 'solid-js'
import type { MinuteTrend } from '@shared/types'
import { fixed, minuteLabel, signed, signedPct } from '@shared/format'
import {
  DAY_SLOTS,
  buildTrendAveragePath,
  buildTrendDayPaths,
  buildTrendGeometry,
  buildTrendLevels,
  buildTrendSeparators,
  buildTrendTicks,
  flattenTrendPoints,
  formatMonthDay,
  locateTrendSlot,
  slotFromX
} from '../lib/chart-geometry'
import { useElementSize } from '../lib/dom'
import { toneLineVar, toneOf } from '../lib/tone'

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

export function TrendChart(props: TrendChartProps): JSX.Element {
  const { size, ref } = useElementSize<HTMLDivElement>()
  const [hoverSlot, setHoverSlot] = createSignal<number | null>(null)

  const days = (): MinuteTrend[] => props.days
  const isMultiDay = (): boolean => days().length > 1

  const geometry = createMemo(() => buildTrendGeometry(days(), size().width, size().height))
  const bars = createMemo(() => flattenTrendPoints(days()))
  const levels = createMemo(() => {
    const geo = geometry()
    return geo ? buildTrendLevels(days(), geo) : []
  })
  const ticks = createMemo(() => buildTrendTicks(days()))
  const separators = createMemo(() => buildTrendSeparators(days()))
  const dayPaths = createMemo(() => {
    const geo = geometry()
    return geo ? buildTrendDayPaths(days(), geo) : []
  })
  const averagePath = createMemo(() => {
    const geo = geometry()
    return geo ? buildTrendAveragePath(days(), geo) : ''
  })

  const hovered = createMemo(() => {
    const slot = hoverSlot()
    const geo = geometry()
    if (slot === null || !geo) return null

    const located = locateTrendSlot(slot, days())
    if (!located) return null

    const day = days()[located.dayIndex]
    const point = day.points[located.pointIndex]
    const change = point.price - day.prevClose

    return {
      point,
      x: geo.x(located.dayIndex * DAY_SLOTS + located.pointIndex),
      y: geo.yPrice(point.price),
      change,
      changePct: day.prevClose > 0 ? (change / day.prevClose) * 100 : 0,
      label: isMultiDay()
        ? `${formatMonthDay(day.date)} ${minuteLabel(point.time)}`
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
    if (!geo || bars().length === 0) return
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
    const slot = slotFromX(event.clientX, rect.left, geo)
    if (slot !== null) setHoverSlot(slot)
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
            <For each={ticks()}>
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
                      x1={geo().padding.left}
                      x2={geo().width - geo().padding.right}
                      y1={y()}
                      y2={y()}
                      stroke="var(--chart-grid)"
                      stroke-dasharray={level.pct === 0 ? undefined : '3 5'}
                    />
                    <text
                      x={geo().width - geo().padding.right + 8}
                      y={y() + 3.5}
                      fill={level.pct === 0 ? 'var(--text-3)' : 'var(--chart-axis)'}
                      font-size="10"
                      class="num"
                    >
                      {fixed(level.value, 2)}
                    </text>
                    <Show when={level.pct !== null}>
                      <text
                        x={geo().width - geo().padding.right + 8}
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
            <For each={bars()}>
              {(item, index) => {
                const previousPrice = (): number => {
                  if (index() === 0) return days()[0]?.prevClose ?? item.point.price
                  return bars()[index() - 1].point.price
                }
                return (
                  <rect
                    x={geo().x(item.slot) - geo().barWidth / 2}
                    y={geo().yVolume(item.point.volume)}
                    width={geo().barWidth}
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
                    d={day.line}
                    fill="none"
                    stroke={toneLineVar(day.tone)}
                    stroke-width="1.6"
                    stroke-linejoin="round"
                    stroke-linecap="round"
                  />
                </g>
              )}
            </For>

            <path
              d={averagePath()}
              fill="none"
              stroke="var(--chart-avg)"
              stroke-width="1.1"
              stroke-dasharray="4 3"
              opacity="0.9"
            />

            {/* ---------- 横轴标签 ---------- */}
            <For each={ticks()}>
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
                    x1={geo().padding.left}
                    x2={geo().width - geo().padding.right}
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
                    stroke={toneLineVar(toneOf(current().change))}
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
              <span class="num" style={{ color: toneLineVar(toneOf(current().change)) }}>
                {fixed(current().point.price)}
              </span>
            </div>
            <div class="chart-tooltip__row">
              <span class="chart-tooltip__label">涨跌幅</span>
              <span class="num" style={{ color: toneLineVar(toneOf(current().change)) }}>
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
