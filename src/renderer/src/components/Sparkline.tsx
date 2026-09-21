/**
 * 迷你走势图（sparkline）。
 *
 * 只做一件事：把一串收盘价压成一条极简折线，让人一眼看出近期趋势。
 * 刻意不画坐标轴、不画网格、不画十字光标——它出现在列表里，
 * 任何多余的元素都会变成视觉噪音。
 */
import { createMemo, Show, type JSX } from 'solid-js'
import { toneOf } from '../lib/tone'

export interface SparklineProps {
  values: number[]
  width?: number
  height?: number
}

export function Sparkline(props: SparklineProps): JSX.Element {
  const geometry = createMemo(() => {
    const values = props.values
    const width = props.width ?? 48
    const height = props.height ?? 22
    if (values.length < 2) return null

    let min = Infinity
    let max = -Infinity
    for (const value of values) {
      min = Math.min(min, value)
      max = Math.max(max, value)
    }
    // 全平的走势也要能画出来，给一个极小的假区间避免除以 0
    const span = max - min || Math.max(1e-6, Math.abs(max) * 0.005)

    const padding = 2.5
    const innerHeight = height - padding * 2
    const step = width / (values.length - 1)

    const points = values.map((value, index) => ({
      x: index * step,
      y: padding + (1 - (value - min) / span) * innerHeight
    }))

    const line = points
      .map(
        (point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(2)},${point.y.toFixed(2)}`
      )
      .join(' ')

    return {
      width,
      height,
      line,
      // 首尾对比决定颜色，和列表里涨跌幅的语义保持一致
      tone: toneOf(values[values.length - 1] - values[0])
    }
  })

  return (
    <Show when={geometry()}>
      {(geo) => (
        <svg
          class="sparkline"
          width={geo().width}
          height={geo().height}
          viewBox={`0 0 ${geo().width} ${geo().height}`}
          fill="none"
        >
          <path
            d={`${geo().line} L${geo().width},${geo().height} L0,${geo().height} Z`}
            fill={color(geo().tone)}
            opacity="0.14"
          />
          <path
            d={geo().line}
            stroke={color(geo().tone)}
            stroke-width="1.3"
            stroke-linejoin="round"
            stroke-linecap="round"
          />
        </svg>
      )}
    </Show>
  )
}

function color(tone: ReturnType<typeof toneOf>): string {
  if (tone === 'up') return 'var(--up-line)'
  if (tone === 'down') return 'var(--down-line)'
  return 'var(--flat)'
}
