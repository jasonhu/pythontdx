/**
 * K 线图（蜡烛图 + 均线 + 成交量）。
 *
 * 手绘 SVG 的另一个好处：想加什么就加什么。
 * 这里实现了 5/10/20 日均线、量价联动的成交量柱、十字光标与浮层读数。
 */
import { createMemo, createSignal, For, Show, type JSX } from 'solid-js'
import type { KLineBar, KLineSeries } from '@shared/types'
import { fixed, signedPct, thousands } from '@shared/format'
import { useElementSize } from '../lib/dom'

const PAD = { top: 18, right: 64, bottom: 22, left: 10 }
const VOLUME_RATIO = 0.2
const GAP = 12

const MA_CONFIG = [
  { period: 5, color: '#f0b429' },
  { period: 10, color: '#5b8cff' },
  { period: 20, color: '#c084fc' }
] as const

export interface KLineChartProps {
  series: KLineSeries
}

export function KLineChart(props: KLineChartProps): JSX.Element {
  const { size, ref } = useElementSize<HTMLDivElement>()
  const [hover, setHover] = createSignal<number | null>(null)

  const bars = (): KLineBar[] => props.series.bars

  /** 各条均线：索引与 bars 对齐，前置不足周期的位置为 null */
  const averages = createMemo(() =>
    MA_CONFIG.map((config) => ({
      ...config,
      values: movingAverage(bars(), config.period)
    }))
  )

  const geometry = createMemo(() => {
    const { width, height } = size()
    const list = bars()
    if (width < 120 || height < 140 || list.length === 0) return null

    const plotW = width - PAD.left - PAD.right
    const plotH = height - PAD.top - PAD.bottom
    const volumeH = plotH * VOLUME_RATIO
    const priceH = plotH - volumeH - GAP
    const priceTop = PAD.top
    const priceBottom = priceTop + priceH
    const volumeTop = priceBottom + GAP
    const volumeBottom = volumeTop + volumeH

    let low = Infinity
    let high = -Infinity
    for (const bar of list) {
      low = Math.min(low, bar.low)
      high = Math.max(high, bar.high)
    }
    // 均线可能略微超出 K 线范围，一并纳入
    for (const average of averages()) {
      for (const value of average.values) {
        if (value === null) continue
        low = Math.min(low, value)
        high = Math.max(high, value)
      }
    }

    const pad = (high - low) * 0.06 || high * 0.01
    const yMax = high + pad
    const yMin = Math.max(0, low - pad)
    const maxVolume = Math.max(1, ...list.map((bar) => bar.volume))
    const slot = plotW / list.length

    return {
      width,
      height,
      plotW,
      priceTop,
      priceBottom,
      volumeBottom,
      yMax,
      yMin,
      maxVolume,
      slot,
      x: (index: number) => PAD.left + (index + 0.5) * slot,
      yPrice: (value: number) => priceTop + ((yMax - value) / (yMax - yMin)) * priceH,
      yVolume: (value: number) => volumeBottom - (value / maxVolume) * volumeH
    }
  })

  /** 纵轴刻度：用「好看的数字」算法自动取步长 */
  const levels = createMemo(() => {
    const geo = geometry()
    if (!geo) return []
    const step = niceStep(geo.yMax - geo.yMin, 5)
    const result: number[] = []
    for (let value = Math.ceil(geo.yMin / step) * step; value <= geo.yMax; value += step) {
      result.push(Number(value.toFixed(4)))
    }
    return result
  })

  const dateTicks = createMemo(() => {
    const list = bars()
    const geo = geometry()
    if (!geo || list.length === 0) return []
    const count = Math.min(6, list.length)
    const ticks: { index: number; label: string }[] = []
    for (let i = 0; i < count; i++) {
      const index = Math.round((i * (list.length - 1)) / Math.max(1, count - 1))
      ticks.push({ index, label: list[index].date.slice(5) })
    }
    return ticks
  })

  const hovered = createMemo(() => {
    const index = hover()
    const geo = geometry()
    const list = bars()
    if (index === null || !geo) return null
    const bar = list[index]
    if (!bar) return null
    const previous = list[index - 1]
    return {
      bar,
      index,
      x: geo.x(index),
      y: geo.yPrice(bar.close),
      changePct: previous ? ((bar.close - previous.close) / previous.close) * 100 : 0,
      averages: averages().map((average) => ({
        period: average.period,
        color: average.color,
        value: average.values[index]
      }))
    }
  })

  const onPointerMove = (event: PointerEvent): void => {
    const geo = geometry()
    const list = bars()
    if (!geo || list.length === 0) return
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
    const ratio = (event.clientX - rect.left - PAD.left) / geo.plotW
    const index = Math.floor(ratio * list.length)
    setHover(Math.min(list.length - 1, Math.max(0, index)))
  }

  return (
    <div
      class="chart-host"
      ref={ref}
      onPointerMove={onPointerMove}
      onPointerLeave={() => setHover(null)}
    >
      <Show when={geometry()} fallback={<div class="chart-empty">正在加载 K 线数据…</div>}>
        {(geo) => (
          <svg class="chart-svg" width={geo().width} height={geo().height}>
            {/* ---------- 横向价格网格 + 右轴刻度 ---------- */}
            <For each={levels()}>
              {(value) => {
                const y = (): number => geo().yPrice(value)
                return (
                  <g>
                    <line
                      x1={PAD.left}
                      x2={geo().width - PAD.right}
                      y1={y()}
                      y2={y()}
                      stroke="var(--chart-grid)"
                    />
                    <text
                      x={geo().width - PAD.right + 8}
                      y={y() + 3.5}
                      fill="var(--chart-axis)"
                      font-size="10"
                      class="num"
                    >
                      {fixed(value, 2)}
                    </text>
                  </g>
                )
              }}
            </For>

            {/* ---------- 成交量柱 ---------- */}
            <For each={bars()}>
              {(bar, index) => {
                const rising = (): boolean => bar.close >= bar.open
                return (
                  <rect
                    x={geo().x(index()) - Math.max(0.5, geo().slot * 0.3)}
                    y={geo().yVolume(bar.volume)}
                    width={Math.max(1, geo().slot * 0.6)}
                    height={Math.max(0, geo().volumeBottom - geo().yVolume(bar.volume))}
                    fill={rising() ? 'var(--up)' : 'var(--down)'}
                    opacity="0.5"
                  />
                )
              }}
            </For>

            {/* ---------- 蜡烛 ---------- */}
            <For each={bars()}>
              {(bar, index) => {
                const rising = (): boolean => bar.close >= bar.open
                const color = (): string => (rising() ? 'var(--up)' : 'var(--down)')
                const bodyTop = (): number => geo().yPrice(Math.max(bar.open, bar.close))
                const bodyHeight = (): number =>
                  Math.max(1, Math.abs(geo().yPrice(bar.open) - geo().yPrice(bar.close)))
                return (
                  <g>
                    <line
                      x1={geo().x(index())}
                      x2={geo().x(index())}
                      y1={geo().yPrice(bar.high)}
                      y2={geo().yPrice(bar.low)}
                      stroke={color()}
                      stroke-width="1"
                    />
                    <rect
                      x={geo().x(index()) - Math.max(0.5, geo().slot * 0.3)}
                      y={bodyTop()}
                      width={Math.max(1, geo().slot * 0.6)}
                      height={bodyHeight()}
                      fill={rising() ? 'transparent' : color()}
                      stroke={color()}
                      stroke-width="1"
                    />
                  </g>
                )
              }}
            </For>

            {/* ---------- 均线 ---------- */}
            <For each={averages()}>
              {(average) => (
                <path
                  d={linePath(
                    average.values.map((value, index) =>
                      value === null ? null : { x: geo().x(index), y: geo().yPrice(value) }
                    )
                  )}
                  fill="none"
                  stroke={average.color}
                  stroke-width="1.2"
                  opacity="0.92"
                />
              )}
            </For>

            {/* ---------- 日期轴 ---------- */}
            <For each={dateTicks()}>
              {(tick) => (
                <text
                  x={geo().x(tick.index)}
                  y={geo().height - 6}
                  fill="var(--text-3)"
                  font-size="10"
                  text-anchor="middle"
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
                </g>
              )}
            </Show>
          </svg>
        )}
      </Show>

      <Show when={hovered()}>
        {(current) => (
          <div
            class="chart-tooltip"
            style={{
              left: `${Math.min(current().x + 14, Math.max(0, size().width - 172))}px`,
              top: '10px'
            }}
          >
            <div class="chart-tooltip__row">
              <span class="chart-tooltip__label">日期</span>
              <span class="num">{current().bar.date}</span>
            </div>
            <div class="chart-tooltip__row">
              <span class="chart-tooltip__label">收盘</span>
              <span
                class="num"
                style={{
                  color: current().bar.close >= current().bar.open ? 'var(--up)' : 'var(--down)'
                }}
              >
                {fixed(current().bar.close)}
              </span>
            </div>
            <div class="chart-tooltip__row">
              <span class="chart-tooltip__label">涨跌幅</span>
              <span class="num">{signedPct(current().changePct)}</span>
            </div>
            <div class="chart-tooltip__row">
              <span class="chart-tooltip__label">开/高</span>
              <span class="num">
                {fixed(current().bar.open)} / {fixed(current().bar.high)}
              </span>
            </div>
            <div class="chart-tooltip__row">
              <span class="chart-tooltip__label">低/收</span>
              <span class="num">
                {fixed(current().bar.low)} / {fixed(current().bar.close)}
              </span>
            </div>
            <div class="chart-tooltip__row">
              <span class="chart-tooltip__label">成交量</span>
              <span class="num">{thousands(current().bar.volume)} 手</span>
            </div>
            <For each={current().averages}>
              {(average) => (
                <div class="chart-tooltip__row">
                  <span class="chart-tooltip__label" style={{ color: average.color }}>
                    MA{average.period}
                  </span>
                  <span class="num">{fixed(average.value ?? undefined)}</span>
                </div>
              )}
            </For>
          </div>
        )}
      </Show>
    </div>
  )
}

/* ------------------------------------------------------------ 纯函数工具 */

/** 简单移动平均，不足周期的位置返回 null */
function movingAverage(bars: KLineBar[], period: number): (number | null)[] {
  const result: (number | null)[] = []
  let sum = 0
  for (let index = 0; index < bars.length; index++) {
    sum += bars[index].close
    if (index >= period) sum -= bars[index - period].close
    result.push(index >= period - 1 ? sum / period : null)
  }
  return result
}

/** 把「可能有断点」的点列转成 SVG 路径（遇 null 起新段） */
function linePath(points: ({ x: number; y: number } | null)[]): string {
  let path = ''
  let pending = false
  for (const point of points) {
    if (!point) {
      pending = false
      continue
    }
    path += `${pending ? 'L' : 'M'}${point.x.toFixed(2)},${point.y.toFixed(2)} `
    pending = true
  }
  return path.trim()
}

/** 取一个「好看」的刻度步长：1 / 2 / 5 × 10^n */
function niceStep(range: number, targetTicks: number): number {
  const raw = range / targetTicks
  if (!Number.isFinite(raw) || raw <= 0) return 1
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)))
  const normalized = raw / magnitude
  const step = normalized >= 5 ? 10 : normalized >= 2 ? 5 : normalized >= 1 ? 2 : 1
  return step * magnitude
}
