/**
 * 分时图（纯 SVG 手绘，零依赖）。
 *
 * 几个「像专业软件」的细节：
 *  1. 横轴固定 240 格 —— 一个交易日 241 个分钟点，盘中只画到当前时刻，
 *     右边留白，而不是把已有数据拉伸铺满整个宽度；
 *  2. 纵轴以昨收为中心上下对称，右轴同时给「价格」和「涨跌幅」两套刻度；
 *  3. 下方叠一条成交量柱，颜色跟随该分钟的涨跌方向；
 *  4. 十字光标 + 浮层读数。
 */
import { createMemo, createSignal, For, Show, type JSX } from 'solid-js'
import type { MinuteTrend } from '@shared/types'
import { fixed, minuteLabel, signed, signedPct } from '@shared/format'
import { useElementSize } from '../lib/dom'
import { toneOf, type Tone } from '../lib/tone'

const PAD = { top: 18, right: 64, bottom: 22, left: 10 }

/** A 股一天 241 个分钟点 → 横轴共 240 个间隔 */
const TOTAL_SLOTS = 240

/** 成交量区占绘图高度的比例 */
const VOLUME_RATIO = 0.2

/** 上下各留的呼吸空间 */
const GAP = 12

export interface TrendChartProps {
  trend: MinuteTrend
}

export function TrendChart(props: TrendChartProps): JSX.Element {
  const { size, ref } = useElementSize<HTMLDivElement>()
  const [hover, setHover] = createSignal<number | null>(null)

  const points = (): MinuteTrend['points'] => props.trend.points
  const prevClose = (): number => props.trend.prevClose

  const geometry = createMemo(() => {
    const { width, height } = size()
    const list = points()
    if (width < 120 || height < 140 || list.length === 0) return null

    const plotW = width - PAD.left - PAD.right
    const plotH = height - PAD.top - PAD.bottom
    const volumeH = plotH * VOLUME_RATIO
    const priceH = plotH - volumeH - GAP
    const priceTop = PAD.top
    const priceBottom = priceTop + priceH
    const volumeTop = priceBottom + GAP
    const volumeBottom = volumeTop + volumeH

    const baseline = prevClose() > 0 ? prevClose() : list[0].price

    // 以昨收为中心，取实际最大偏离量决定纵轴范围
    let deviation = 0
    for (const point of list) {
      deviation = Math.max(
        deviation,
        Math.abs(point.price - baseline),
        Math.abs(point.avg - baseline)
      )
    }
    if (deviation < baseline * 1e-4) deviation = baseline * 0.002
    const pad = deviation * 1.12

    const yMax = baseline + pad
    const yMin = baseline - pad
    const maxVolume = Math.max(1, ...list.map((point) => point.volume))

    return {
      width,
      height,
      plotW,
      plotH,
      priceTop,
      priceBottom,
      volumeTop,
      volumeBottom,
      yMax,
      yMin,
      baseline,
      maxVolume,
      x: (index: number) => PAD.left + (index / TOTAL_SLOTS) * plotW,
      yPrice: (value: number) => priceTop + ((yMax - value) / (yMax - yMin)) * priceH,
      yVolume: (value: number) => volumeBottom - (value / maxVolume) * volumeH
    }
  })

  /** 最后一点相对昨收的涨跌，决定主色调 */
  const tone = createMemo<Tone>(() => {
    const list = points()
    const last = list[list.length - 1]
    return last ? toneOf(last.price - prevClose()) : 'flat'
  })

  const strokeColor = (): string =>
    tone() === 'up' ? 'var(--up-line)' : tone() === 'down' ? 'var(--down-line)' : 'var(--flat)'

  const pricePath = createMemo(() => {
    const geo = geometry()
    if (!geo) return ''
    return points()
      .map((point, index) => {
        const command = index === 0 ? 'M' : 'L'
        return `${command}${geo.x(index).toFixed(2)},${geo.yPrice(point.price).toFixed(2)}`
      })
      .join(' ')
  })

  const avgPath = createMemo(() => {
    const geo = geometry()
    if (!geo) return ''
    return points()
      .map((point, index) => {
        const command = index === 0 ? 'M' : 'L'
        return `${command}${geo.x(index).toFixed(2)},${geo.yPrice(point.avg).toFixed(2)}`
      })
      .join(' ')
  })

  const areaPath = createMemo(() => {
    const geo = geometry()
    const list = points()
    if (!geo || list.length === 0) return ''
    const last = list.length - 1
    return `${pricePath()} L${geo.x(last).toFixed(2)},${geo.priceBottom} L${geo.x(0).toFixed(2)},${geo.priceBottom} Z`
  })

  /** 纵轴刻度：根据波动幅度自动选择 0.5% / 1% / 2% / 5% 的步长 */
  const levels = createMemo(() => {
    const geo = geometry()
    if (!geo) return []
    const base = geo.baseline
    const rangePct = ((geo.yMax - geo.yMin) / base) * 100
    const step =
      rangePct <= 2 ? 0.5 : rangePct <= 4 ? 1 : rangePct <= 9 ? 2 : rangePct <= 20 ? 5 : 10

    const result: { value: number; pct: number }[] = [{ value: base, pct: 0 }]
    for (let pct = step; pct <= rangePct / 2 + step; pct += step) {
      const up = base * (1 + pct / 100)
      const down = base * (1 - pct / 100)
      if (up < geo.yMax) result.push({ value: up, pct })
      if (down > geo.yMin) result.push({ value: down, pct: -pct })
    }
    return result.sort((a, b) => b.value - a.value)
  })

  const timeTicks = [
    { slot: 0, label: '09:30' },
    { slot: 60, label: '10:30' },
    { slot: 120, label: '11:30/13:00' },
    { slot: 180, label: '14:00' },
    { slot: 240, label: '15:00' }
  ]

  const hovered = createMemo(() => {
    const index = hover()
    if (index === null) return null
    const point = points()[index]
    const geo = geometry()
    if (!point || !geo) return null
    return {
      point,
      index,
      x: geo.x(index),
      y: geo.yPrice(point.price),
      changePct: ((point.price - prevClose()) / prevClose()) * 100
    }
  })

  const onPointerMove = (event: PointerEvent): void => {
    const geo = geometry()
    const list = points()
    if (!geo || list.length === 0) return

    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
    const ratio = (event.clientX - rect.left - PAD.left) / geo.plotW
    const index = Math.round(ratio * TOTAL_SLOTS)
    setHover(Math.min(list.length - 1, Math.max(0, index)))
  }

  return (
    <div
      class="chart-host"
      ref={ref}
      onPointerMove={onPointerMove}
      onPointerLeave={() => setHover(null)}
    >
      <Show when={geometry()} fallback={<div class="chart-empty">正在加载分时数据…</div>}>
        {(geo) => (
          <svg class="chart-svg" width={geo().width} height={geo().height}>
            <defs>
              <linearGradient id="trend-area" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color={strokeColor()} stop-opacity="0.34" />
                <stop offset="100%" stop-color={strokeColor()} stop-opacity="0" />
              </linearGradient>
            </defs>

            {/* ---------- 纵向时间网格 ---------- */}
            <For each={timeTicks}>
              {(tick) => {
                const x = (): number => geo().x(tick.slot)
                return (
                  <line
                    x1={x()}
                    x2={x()}
                    y1={geo().priceTop}
                    y2={geo().volumeBottom}
                    stroke="var(--chart-grid)"
                  />
                )
              }}
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
                    <text
                      x={geo().width - PAD.right + 8}
                      y={y() + 14}
                      fill="var(--text-3)"
                      font-size="9"
                      class="num"
                    >
                      {level.pct === 0 ? '0.00%' : signedPct(level.pct)}
                    </text>
                  </g>
                )
              }}
            </For>

            {/* ---------- 成交量柱 ---------- */}
            <For each={points()}>
              {(point, index) => {
                const previous = (): number =>
                  index() === 0 ? prevClose() : points()[index() - 1].price
                const height = (): number =>
                  Math.max(0, geo().volumeBottom - geo().yVolume(point.volume))
                return (
                  <rect
                    x={geo().x(index()) - Math.max(0.6, (geo().plotW / TOTAL_SLOTS) * 0.32)}
                    y={geo().yVolume(point.volume)}
                    width={Math.max(1.2, (geo().plotW / TOTAL_SLOTS) * 0.64)}
                    height={height()}
                    fill={point.price >= previous() ? 'var(--up)' : 'var(--down)'}
                    opacity="0.55"
                  />
                )
              }}
            </For>

            {/* ---------- 面积 + 价格线 + 均价线 ---------- */}
            <path d={areaPath()} fill="url(#trend-area)" />
            <path
              d={pricePath()}
              fill="none"
              stroke={strokeColor()}
              stroke-width="1.6"
              stroke-linejoin="round"
              stroke-linecap="round"
            />
            <path
              d={avgPath()}
              fill="none"
              stroke="var(--chart-avg)"
              stroke-width="1.1"
              stroke-dasharray="4 3"
              opacity="0.9"
            />

            {/* ---------- 最新价标记 ---------- */}
            <Show when={points().length > 0}>
              <circle
                cx={geo().x(points().length - 1)}
                cy={geo().yPrice(points()[points().length - 1].price)}
                r="2.6"
                fill={strokeColor()}
              />
            </Show>

            {/* ---------- 时间轴标签 ---------- */}
            <For each={timeTicks}>
              {(tick) => (
                <text
                  x={geo().x(tick.slot)}
                  y={geo().height - 6}
                  fill="var(--text-3)"
                  font-size="10"
                  text-anchor={tick.slot === 0 ? 'start' : tick.slot === 240 ? 'end' : 'middle'}
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
                    stroke={strokeColor()}
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
              left: `${Math.min(current().x + 14, Math.max(0, size().width - 156))}px`,
              top: '10px'
            }}
          >
            <div class="chart-tooltip__row">
              <span class="chart-tooltip__label">时间</span>
              <span class="num">{minuteLabel(current().point.time)}</span>
            </div>
            <div class="chart-tooltip__row">
              <span class="chart-tooltip__label">价格</span>
              <span class="num" style={{ color: strokeColor() }}>
                {fixed(current().point.price)}
              </span>
            </div>
            <div class="chart-tooltip__row">
              <span class="chart-tooltip__label">涨跌幅</span>
              <span class="num" style={{ color: strokeColor() }}>
                {signedPct(current().changePct)}
              </span>
            </div>
            <div class="chart-tooltip__row">
              <span class="chart-tooltip__label">涨跌额</span>
              <span class="num">{signed(current().point.price - prevClose())}</span>
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
