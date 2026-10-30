/**
 * K 线图（蜡烛图 + 均线 + 成交量）。
 *
 * 手绘 SVG 的另一个好处：想加什么就加什么。
 * 这里实现了 5/10/20 日均线、量价联动的成交量柱、十字光标与浮层读数。
 *
 * 与分时图一样，坐标换算全部委托给 `lib/chart-geometry.ts` 里的纯函数。
 */
import { createMemo, createSignal, For, onCleanup, onMount, Show, type JSX } from 'solid-js'
import type { KLineSeries } from '@shared/types'
import { fixed, signedPct, thousands } from '@shared/format'
import { boll } from '@shared/indicators'
import {
  accumulateWheel,
  buildKLineGeometry,
  buildKLineLevels,
  buildKLineTicks,
  buildLinePath,
  cursorFromX,
  KLINE_BARS_MAX,
  klineWindow,
  movingAverage,
  nearestZoomLevel,
  nextZoomLevel,
  stepCursor,
  zoomWindow
} from '../lib/chart-geometry'
import { chartOwnsKeys } from '../lib/chart-keys'
import { useElementSize } from '../lib/dom'
import { appState, updateSettings } from '../stores/app'

/** 均线的周期与配色 */
const MA_CONFIG = [
  { period: 5, color: '#f0b429' },
  { period: 10, color: '#5b8cff' },
  { period: 20, color: '#c084fc' }
] as const

export interface KLineChartProps {
  series: KLineSeries
  /** 是否叠加 BOLL(20,2) */
  boll?: boolean
}

/** 默认档位：显示全部 K 线 */
const DEFAULT_COUNT = KLINE_BARS_MAX

export function KLineChart(props: KLineChartProps): JSX.Element {
  const { size, ref } = useElementSize<HTMLDivElement>()
  /** 图表容器元素：滚轮监听要显式声明非 passive，所以得自己拿到它 */
  let host: HTMLDivElement | undefined

  /**
   * 可见根数（缩放档位）。
   * 初值取自上次运行存下来的档位，先吸附回档位表 ——
   * 万一存档里的值不在表上（改过档位表 / 手改过设置文件），也不会卡在一个怪状态。
   */
  const [count, setCount] = createSignal<number>(
    nearestZoomLevel(appState.settings.klineZoom ?? DEFAULT_COUNT)
  )
  /** 窗口左端下标；null = 贴着最新一根（右对齐） */
  const [start, setStart] = createSignal<number | null>(null)
  /**
   * 光标所在的**绝对**下标。
   * 存绝对值而不是窗口内的相对下标，是「缩放后不漂移」的关键（`docs/06` 第 23 条）。
   */
  const [cursor, setCursor] = createSignal<number | null>(null)
  /**
   * 鼠标是否停在图表上。
   * 键盘归属判断要用它：滚轮**不用点**就能用，键盘也不该要求先点一下（见 `onKeyDown`）。
   */
  const [hovering, setHovering] = createSignal(false)

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

  const bollBands = createMemo(() => (props.boll ? boll(allBars(), 20, 2) : null))
  const visibleBoll = createMemo(() => {
    const bands = bollBands()
    if (!bands) return null
    const slice = (values: number[]): number[] =>
      values.slice(win().start, win().start + win().count)
    return {
      upper: slice(bands.upper),
      middle: slice(bands.middle),
      lower: slice(bands.lower)
    }
  })

  const geometry = createMemo(() => {
    const bands = visibleBoll()
    const extra = bands ? [...bands.upper, ...bands.middle, ...bands.lower] : []
    return buildKLineGeometry(bars(), size().width, size().height, undefined, extra)
  })
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

  /**
   * 换档。以**锚点那一根**为锚：缩放前后它落在屏幕上的同一处，
   * 不会出现「指着的 K 线换了一根」（`docs/06` 第 23 条）。
   * 锚点默认是当前光标；滚轮会传鼠标位置算出来的那一根。
   */
  const zoomBy = (direction: 'in' | 'out', anchor: number | null = cursorIndex()): void => {
    const next = nextZoomLevel(count(), direction)
    if (next === count()) return // 已经到顶 / 到底
    const anchored = zoomWindow(win(), total(), next, anchor)
    setCount(anchored.count)
    setStart(anchored.start)
    // 记住档位：下次打开还是这个尺度（设置项是可选的，读的时候用 ?? 兜底）
    updateSettings({ klineZoom: anchored.count })
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

  /** 滚轮累计量：攒够一格才换档，余量留到下一次（见 accumulateWheel） */
  let wheelAccumulated = 0

  /**
   * 滚轮缩放：向上滚放大（与 `↑` 一致），锚点是**鼠标位置那一根**。
   *
   * 为什么要手动 addEventListener，而不是用 Solid 的 `onWheel`？
   * 因为必须显式声明 `passive: false` —— Chrome 对滚动类事件默认按 passive 处理，
   * 那种情况下 `preventDefault()` 无效（控制台会提示
   * "Unable to preventDefault inside passive event listener"）。
   * `onWheel` 是 addEventListener 的语法糖，给不了这个选项。
   */
  const onWheel = (event: WheelEvent): void => {
    // 图表里没有可滚动的内容，但这样能保证滚轮「只用于缩放」，不会顺手滚动页面
    event.preventDefault()

    const step = accumulateWheel(wheelAccumulated, event.deltaY)
    wheelAccumulated = step.rest
    if (!step.direction) return

    const geo = geometry()
    if (!geo) return

    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
    const anchor = cursorFromX(event.clientX - rect.left, win(), geo.padding.left, geo.plotW)
    // 光标跟着鼠标走：滚轮缩放时人是盯着指针的，读数该同步过去
    setCursor(anchor)
    zoomBy(step.direction, anchor)
  }

  onMount(() => {
    if (!host) return
    host.addEventListener('wheel', onWheel, { passive: false })
    // 键盘监听挂在 window 上而不是图表自己身上，理由见 onKeyDown 的注释
    window.addEventListener('keydown', onKeyDown)
    onCleanup(() => {
      host?.removeEventListener('wheel', onWheel)
      window.removeEventListener('keydown', onKeyDown)
    })
  })

  /** 事件落点是不是输入控件：搜索框正在用 ↑↓ 选联想项，侧栏改名框也在等按键 */
  const isTyping = (event: KeyboardEvent): boolean => {
    const element = event.target as HTMLElement | null
    return (
      element?.tagName === 'INPUT' ||
      element?.tagName === 'TEXTAREA' ||
      element?.isContentEditable === true
    )
  }

  /**
   * 键盘操作。**监听挂在 window 上**，而不是挂在图表自己身上。
   *
   * 为什么？挂在图表上就等于「必须先点一下图，键盘才生效」，可滚轮不用点就能用 ——
   * 同一张图两套规则，用户第一次用键盘必然踩空：点完「日K」标签后焦点还留在那个按钮上，
   * `↑` 落在按钮上，图一动不动，焦点圈反而亮到了标签上（用户实测反馈）。
   * 所以改成「指针在图上，或图有焦点」就归这张图管（判断抽在 `lib/chart-keys.ts` 里单测），
   * 并且在接管的那一刻把焦点收回图表 —— 否则「现在是谁在响应键盘」在界面上看不出来。
   *
   * 键位对齐主流行情软件：
   *   ↑ / ↓  横向伸张 / 收缩（柱子变宽 / 变窄）
   *   ← / →  移动十字光标，走到边上就平移窗口
   *   End    回到最新一根
   *   Esc    收起光标
   */
  const onKeyDown = (event: KeyboardEvent): void => {
    const owned = chartOwnsKeys({
      hovering: hovering(),
      chartFocused: document.activeElement === host,
      typing: isTyping(event)
    })
    if (!owned) return

    if (document.activeElement !== host) host?.focus({ preventScroll: true })

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
      ref={(element: HTMLDivElement) => {
        host = element
        ref(element)
      }}
      tabindex="0"
      aria-label="K 线图：滚轮或上下键缩放、左右键移动光标"
      onPointerEnter={() => setHovering(true)}
      onPointerMove={onPointerMove}
      onPointerLeave={() => {
        // 指针离开就交还键盘、收起光标：别让「谁在响应键盘」含糊着
        setHovering(false)
        setCursor(null)
      }}
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

            {/* ---------- BOLL 叠加 ---------- */}
            <Show when={visibleBoll()}>
              {(bands) => (
                <g>
                  <For
                    each={[
                      { values: bands().upper, color: '#f0b429', label: 'UP' },
                      { values: bands().middle, color: '#5b8cff', label: 'MID' },
                      { values: bands().lower, color: '#c084fc', label: 'LOW' }
                    ]}
                  >
                    {(line) => (
                      <path
                        d={buildLinePath(
                          line.values.map((value, index) =>
                            Number.isFinite(value)
                              ? { x: geo().x(index), y: geo().yPrice(value) }
                              : null
                          )
                        )}
                        fill="none"
                        stroke={line.color}
                        stroke-width="1.1"
                        opacity="0.8"
                      />
                    )}
                  </For>
                </g>
              )}
            </Show>

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
