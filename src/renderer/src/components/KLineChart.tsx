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
  cursorFromX,
  KLINE_BARS_MAX,
  klineWindow,
  movingAverage,
  nextZoomLevel,
  stepCursor,
  zoomWindow
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

/** 默认档位：显示全部 K 线 */
const DEFAULT_COUNT = KLINE_BARS_MAX

export function KLineChart(props: KLineChartProps): JSX.Element {
  const { size, ref } = useElementSize<HTMLDivElement>()

  /** 可见根数（缩放档位） */
  const [count, setCount] = createSignal<number>(DEFAULT_COUNT)
  /** 窗口左端下标；null = 贴着最新一根（右对齐） */
  const [start, setStart] = createSignal<number | null>(null)
  /**
   * 光标所在的**绝对**下标。
   * 存绝对值而不是窗口内的相对下标，是「缩放后不漂移」的关键（`docs/06` 第 23 条）。
   */
  const [cursor, setCursor] = createSignal<number | null>(null)

  /** 全量 K 线 */
  const allBars = (): KLineSeries['bars'] => props.series.bars
  const total = (): number => allBars().length

  /** 可见窗口：默认右对齐，被左右键平移过就按 start 走（两端自动钳位） */
  const win = createMemo(() => klineWindow(total(), count(), start() ?? undefined))

  /** 光标下标：数据换了（切股票 / 切周期）也得钳在有效范围内 */
  const cursorIndex = createMemo(() => {
    const value = cursor()
    if (value === null || total() === 0) return null
    return Math.min(total() - 1, Math.max(0, value))
  })

  /** 真正参与绘制的切片 —— 几何层拿到它之后会自动重算蜡烛宽度 */
  const bars = createMemo(() => {
    const view = win()
    return allBars().slice(view.start, view.start + view.count)
  })

  /**
   * 各条均线：必须在**全量**上计算。
   * 只拿可见切片去算的话，窗口起点那几根的 MA 会因为缺少前置数据而变成 null，
   * 看起来就像均线在图表左边被「剪掉」了一截。
   */
  const averages = createMemo(() =>
    MA_CONFIG.map((config) => ({
      ...config,
      values: movingAverage(allBars(), config.period)
    }))
  )

  /** 均线同样要切片，否则 x 坐标会和蜡烛整体错位 */
  const visibleAverages = createMemo(() => {
    const view = win()
    return averages().map((average) => ({
      ...average,
      values: average.values.slice(view.start, view.start + view.count)
    }))
  })

  const geometry = createMemo(() => buildKLineGeometry(bars(), size().width, size().height))
  const levels = createMemo(() => {
    const geo = geometry()
    return geo ? buildKLineLevels(geo) : []
  })
  const dateTicks = createMemo(() => buildKLineTicks(bars()))

  /**
   * 光标那一根的读数。鼠标悬停和键盘左右键**共用同一份状态**，
   * 所以两者不会各指一根、也不会互相打架。
   */
  const cursorReadout = createMemo(() => {
    const absolute = cursorIndex()
    const geo = geometry()
    if (absolute === null || !geo) return null

    const bar = allBars()[absolute]
    if (!bar) return null

    // 涨跌幅要跟前一根比。窗口最左边那根的前一根不在窗口里，得回全量数组去取，
    // 否则它会被算成 0（看起来像是那天没涨没跌）。
    const previous = allBars()[absolute - 1]
    return {
      bar,
      x: geo.x(absolute - win().start),
      y: geo.yPrice(bar.close),
      changePct: previous ? ((bar.close - previous.close) / previous.close) * 100 : 0,
      averages: averages().map((average) => ({
        period: average.period,
        color: average.color,
        value: average.values[absolute]
      }))
    }
  })

  const onPointerMove = (event: PointerEvent): void => {
    const geo = geometry()
    if (!geo) return

    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
    // 用鼠标位置换算**绝对**下标：缩放或平移之后，同一个屏幕位置对应的 K 线变了，
    // 但我们记的是「哪一根」，所以窗口动的时候光标不会跟着跑。
    setCursor(cursorFromX(event.clientX - rect.left, win(), geo.padding.left, geo.plotW))
  }

  /** 上下键换档：以光标那一根为锚点，缩放前后它落在屏幕上的同一处 */
  const zoomBy = (direction: 'in' | 'out'): void => {
    const next = nextZoomLevel(count(), direction)
    if (next === count()) return // 已经到顶 / 到底
    const anchored = zoomWindow(win(), total(), next, cursorIndex())
    setCount(anchored.count)
    setStart(anchored.start)
  }

  /** 左右键移动光标；走到窗口边上时窗口跟着平移，这样能一路走到任意一根 */
  const stepCursorBy = (delta: number): void => {
    const moved = stepCursor(cursorIndex(), delta, win(), total())
    setCursor(moved.cursor)
    setStart(moved.window.start)
  }

  /** End：回到最新一根 —— 平移之后总得有条一键回来的路（主流软件都有） */
  const goLatest = (): void => {
    setStart(null)
    setCursor(total() === 0 ? null : total() - 1)
  }

  /**
   * 键盘操作。只在图表自己拿到焦点时才响应 —— 否则会和搜索框抢方向键
   *（搜索框正在用上下键在联想列表里选择）。
   *
   * 键位对齐主流行情软件：
   *   ↑ / ↓  横向伸张 / 收缩（柱子变宽 / 变窄）
   *   ← / →  移动十字光标，走到边上就平移窗口
   *   End    回到最新一根
   *   Esc    收起光标
   */
  const onKeyDown = (event: KeyboardEvent): void => {
    switch (event.key) {
      case 'ArrowUp':
      case 'ArrowDown':
        // 不拦下来的话，方向键会去滚动容器（默认行为）
        event.preventDefault()
        zoomBy(event.key === 'ArrowUp' ? 'in' : 'out')
        return
      case 'ArrowLeft':
      case 'ArrowRight':
        event.preventDefault()
        stepCursorBy(event.key === 'ArrowLeft' ? -1 : 1)
        return
      case 'End':
        event.preventDefault()
        goLatest()
        return
      case 'Escape':
        setCursor(null)
        return
      default:
        return
    }
  }

  return (
    <div
      class="chart-host"
      ref={ref}
      tabindex="0"
      aria-label="K 线图：上下键缩放、左右键移动光标"
      onKeyDown={onKeyDown}
      onPointerMove={onPointerMove}
      onPointerLeave={() => setCursor(null)}
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
            <For each={visibleAverages()}>
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

            {/* ---------- 缩放档位 ---------- */}
            {/*
              写在图表自己的上边距里，而不是卡片头部：
              头部在 1024 最小窗口下已经被 tab + 图例占满，再塞一块会把图例挤到 tab 上。
              这里是天然的空白带，永远不会压到蜡烛和网格线。
            */}
            <text
              class="chart-zoom"
              x={geo().padding.left}
              y="12"
              fill="var(--text-3)"
              font-size="10"
            >
              {`↑↓ 缩放 · 近 ${win().count} 根`}
            </text>

            {/* ---------- 十字光标 ---------- */}
            <Show when={cursorReadout()}>
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

      <Show when={cursorReadout()}>
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
