/**
 * K 线副图：MACD / KDJ / RSI。
 *
 * 与指标面板共用 shared/indicators 的纯函数；只画最后 160 根，避免副图挤成噪声。
 */
import { createMemo, For, type JSX } from 'solid-js'
import type { KLineBar } from '@shared/types'
import { fixed } from '@shared/format'
import { bias, cci, kdj, macd, rsi, wr } from '@shared/indicators'

export type SubIndicator = 'macd' | 'kdj' | 'rsi' | 'wr' | 'cci' | 'bias'

const W = 900
const H = 120
const PAD_X = 12
const PAD_Y = 12
const VISIBLE = 160

const COLORS = {
  dif: '#5b8cff',
  dea: '#f0b429',
  k: '#5b8cff',
  d: '#f0b429',
  j: '#c084fc',
  rsi: '#5b8cff',
  wr: '#22d3ee',
  cci: '#f59e0b',
  bias6: '#5b8cff',
  bias12: '#f0b429',
  bias24: '#c084fc'
}

function path(values: number[], min: number, max: number): string {
  const span = max - min || 1
  return values
    .map((value, index) => {
      if (!Number.isFinite(value)) return ''
      const x = PAD_X + (index / Math.max(1, values.length - 1)) * (W - PAD_X * 2)
      const y = H - PAD_Y - ((value - min) / span) * (H - PAD_Y * 2)
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`
    })
    .filter(Boolean)
    .join(' ')
}

export function IndicatorSubchart(props: { bars: KLineBar[]; kind: SubIndicator }): JSX.Element {
  const visible = createMemo(() => props.bars.slice(-VISIBLE))

  const chart = createMemo(() => {
    const data = visible()
    if (data.length < 2) return null
    const all = props.bars
    const offset = Math.max(0, all.length - data.length)
    const slice = (values: number[]): number[] => values.slice(offset)
    if (props.kind === 'macd') {
      const values = macd(all)
      const dif = slice(values.dif)
      const dea = slice(values.dea)
      const hist = slice(values.hist)
      const numbers = [...dif, ...dea, ...hist].filter(Number.isFinite)
      const min = Math.min(0, ...numbers)
      const max = Math.max(0, ...numbers)
      const zeroY = H - PAD_Y - ((0 - min) / (max - min || 1)) * (H - PAD_Y * 2)
      const barWidth = Math.max(1, (W - PAD_X * 2) / Math.max(1, hist.length) - 1)
      return {
        lines: [
          { label: 'DIF', color: COLORS.dif, d: path(dif, min, max) },
          { label: 'DEA', color: COLORS.dea, d: path(dea, min, max) }
        ],
        hist: hist.map((value, index) => ({
          x: PAD_X + (index / Math.max(1, hist.length - 1)) * (W - PAD_X * 2) - barWidth / 2,
          y: value >= 0 ? H - PAD_Y - ((value - min) / (max - min || 1)) * (H - PAD_Y * 2) : zeroY,
          h: Math.abs((value / (max - min || 1)) * (H - PAD_Y * 2)),
          up: value >= 0
        })),
        latest: `DIF ${fixed(dif.at(-1) ?? 0)} · DEA ${fixed(dea.at(-1) ?? 0)} · MACD ${fixed(hist.at(-1) ?? 0)}`
      }
    }
    if (props.kind === 'kdj') {
      const values = kdj(all)
      const k = slice(values.k)
      const d = slice(values.d)
      const j = slice(values.j)
      const numbers = [...k, ...d, ...j]
      const min = Math.min(...numbers)
      const max = Math.max(...numbers)
      return {
        lines: [
          { label: 'K', color: COLORS.k, d: path(k, min, max) },
          { label: 'D', color: COLORS.d, d: path(d, min, max) },
          { label: 'J', color: COLORS.j, d: path(j, min, max) }
        ],
        hist: [],
        latest: `K ${fixed(k.at(-1) ?? 0)} · D ${fixed(d.at(-1) ?? 0)} · J ${fixed(j.at(-1) ?? 0)}`
      }
    }
    if (props.kind === 'wr') {
      const values = slice(wr(all))
      return {
        lines: [{ label: 'WR14', color: COLORS.wr, d: path(values, 0, 100) }],
        hist: [],
        latest: `WR14 ${fixed(values.at(-1) ?? 0)}`
      }
    }
    if (props.kind === 'cci') {
      const values = slice(cci(all))
      const numbers = values.filter(Number.isFinite)
      const min = Math.min(...numbers)
      const max = Math.max(...numbers)
      return {
        lines: [{ label: 'CCI14', color: COLORS.cci, d: path(values, min, max) }],
        hist: [],
        latest: `CCI14 ${fixed(values.at(-1) ?? 0)}`
      }
    }
    if (props.kind === 'bias') {
      const b6 = slice(bias(all, 6))
      const b12 = slice(bias(all, 12))
      const b24 = slice(bias(all, 24))
      const numbers = [...b6, ...b12, ...b24].filter(Number.isFinite)
      const min = Math.min(...numbers)
      const max = Math.max(...numbers)
      return {
        lines: [
          { label: 'BIAS6', color: COLORS.bias6, d: path(b6, min, max) },
          { label: 'BIAS12', color: COLORS.bias12, d: path(b12, min, max) },
          { label: 'BIAS24', color: COLORS.bias24, d: path(b24, min, max) }
        ],
        hist: [],
        latest: `6 ${fixed(b6.at(-1) ?? 0)} · 12 ${fixed(b12.at(-1) ?? 0)} · 24 ${fixed(b24.at(-1) ?? 0)}`
      }
    }
    const values = slice(rsi(all))
    return {
      lines: [{ label: 'RSI14', color: COLORS.rsi, d: path(values, 0, 100) }],
      hist: [],
      latest: `RSI14 ${fixed(values.at(-1) ?? 0)}`
    }
  })

  return (
    <div class="indicator-subchart">
      <div class="indicator-subchart__head">
        <span>{props.kind.toUpperCase()}</span>
        <span class="num">{chart()?.latest ?? '—'}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" class="indicator-subchart__svg">
        <line
          x1={PAD_X}
          y1={H - PAD_Y}
          x2={W - PAD_X}
          y2={H - PAD_Y}
          class="indicator-subchart__axis"
        />
        <For each={chart()?.hist ?? []}>
          {(bar) => (
            <rect
              x={bar.x}
              y={bar.y}
              width={2}
              height={Math.max(1, bar.h)}
              class={bar.up ? 'indicator__hist-up' : 'indicator__hist-down'}
            />
          )}
        </For>
        <For each={chart()?.lines ?? []}>
          {(line) => <path d={line.d} fill="none" stroke={line.color} stroke-width="1.2" />}
        </For>
      </svg>
    </div>
  )
}
