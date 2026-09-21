/**
 * K 线图（蜡烛图 + 均线 + 成交量）。
 *
 * 手绘 SVG 的另一个好处：想加什么就加什么。
 * 这里实现了 5/10/20 日均线、量价联动的成交量柱、十字光标与浮层读数。
 *
 * 与分时图一样，坐标换算全部委托给 `lib/chart-geometry.ts` 里的纯函数。
 */
import { createMemo, createSignal, For, Show, type JSX } from 'solid-js'
import type { KLineSeries } from '@shared/types'
import { fixed, signedPct, thousands } from '@shared/format'
import {
  buildKLineGeometry,
  buildKLineLevels,
  buildKLineTicks,
  buildLinePath,
  movingAverage
} from '../lib/chart-geometry'
import { useElementSize } from '../lib/dom'

/** 均线的周期与配色 */
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
  const [hoverIndex, setHoverIndex] = createSignal<number | null>(null)

  const bars = (): KLineSeries['bars'] => props.series.bars

  /** 各条均线：索引与 bars 对齐，前置不足周期的位置为 null */
  const averages = createMemo(() =>
    MA_CONFIG.map((config) => ({
      ...config,
      values: movingAverage(bars(), config.period)
    }))
  )

  const geometry = createMemo(() => buildKLineGeometry(bars(), size().width, size().height))
  const levels = createMemo(() => {
    const geo = geometry()
    return geo ? buildKLineLevels(geo) : []
  })
  const dateTicks = createMemo(() => buildKLineTicks(bars()))

  const hovered = createMemo(() => {
    const index = hoverIndex()
    const geo = geometry()
    const list = bars()
    if (index === null || !geo) return null

    const bar = list[index]
    if (!bar) return null

    const previous = list[index - 1]
    return {
      bar,
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
    const ratio = (event.clientX - rect.left - geo.padding.left) / geo.plotW
    const index = Math.floor(ratio * list.length)
    setHoverIndex(Math.min(list.length - 1, Math.max(0, index)))
  }

  return (
    <div
      class="chart-host"
      ref={ref}
      onPointerMove={onPointerMove}
      onPointerLeave={() => setHoverIndex(null)}
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
                      x1={geo().padding.left}
                      x2={geo().width - geo().padding.right}
                      y1={y()}
                      y2={y()}
                      stroke="var(--chart-grid)"
                    />
                    <text
                      x={geo().width - geo().padding.right + 8}
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
              {(bar, index) => (
                <rect
                  x={geo().x(index()) - geo().bodyWidth / 2}
                  y={geo().yVolume(bar.volume)}
                  width={geo().bodyWidth}
                  height={Math.max(0, geo().volumeBottom - geo().yVolume(bar.volume))}
                  fill={bar.close >= bar.open ? 'var(--up)' : 'var(--down)'}
                  opacity="0.5"
                />
              )}
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
                      x={geo().x(index()) - geo().bodyWidth / 2}
                      y={bodyTop()}
                      width={geo().bodyWidth}
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
                  d={buildLinePath(
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
                    x1={geo().padding.left}
                    x2={geo().width - geo().padding.right}
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
