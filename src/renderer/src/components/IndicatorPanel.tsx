/**
 * 技术指标面板：MACD / KDJ / RSI / BOLL。
 *
 * 纯本地计算，不请求额外数据；图表只取最近 160 根日 K 显示。
 */
import { createEffect, createMemo, createSignal, For, Show, type JSX } from 'solid-js'
import type { KLineBar } from '@shared/types'
import { fixed } from '@shared/format'
import { boll, kdj, macd, rsi } from '@shared/indicators'
import { api, errorMessage } from '../lib/ipc'
import { IconClose } from './Icons'

type Tab = 'macd' | 'kdj' | 'rsi' | 'boll'

const W = 900
const H = 300
const PAD = 20
const VISIBLE = 160

const COLORS = {
  dif: '#5b8cff',
  dea: '#f0b429',
  k: '#5b8cff',
  d: '#f0b429',
  j: '#c084fc',
  rsi: '#5b8cff',
  close: '#d7dce7',
  upper: '#f0b429',
  middle: '#5b8cff',
  lower: '#c084fc'
}

function linePath(values: number[], min: number, max: number): string {
  const span = max - min || 1
  return values
    .map((value, index) => {
      if (!Number.isFinite(value)) return ''
      const x = PAD + (index / Math.max(1, values.length - 1)) * (W - PAD * 2)
      const y = H - PAD - ((value - min) / span) * (H - PAD * 2)
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`
    })
    .filter(Boolean)
    .join(' ')
    .replace(/([ML])\s*$/, '')
}

export function IndicatorPanel(props: {
  code: string
  name: string
  onClose: () => void
}): JSX.Element {
  const [tab, setTab] = createSignal<Tab>('macd')
  const [bars, setBars] = createSignal<KLineBar[]>([])
  const [loading, setLoading] = createSignal(true)
  const [error, setError] = createSignal<string | null>(null)
  let requestId = 0

  createEffect(() => {
    const current = ++requestId
    setLoading(true)
    setError(null)
    void (async () => {
      try {
        const series = await api.trend.kline({ code: props.code, period: 'day', count: 320 })
        if (current !== requestId) return
        setBars(series.bars)
      } catch (cause) {
        if (current === requestId) setError(errorMessage(cause))
      } finally {
        if (current === requestId) setLoading(false)
      }
    })()
  })

  const visible = createMemo(() => bars().slice(-VISIBLE))

  const chart = createMemo(() => {
    const data = visible()
    if (data.length < 2) return null
    const all = bars()
    const offset = Math.max(0, all.length - data.length)
    const slice = (values: number[]): number[] => values.slice(offset)
    if (tab() === 'macd') {
      const values = macd(all)
      const dif = slice(values.dif)
      const dea = slice(values.dea)
      const hist = slice(values.hist)
      const numbers = [...dif, ...dea, ...hist].filter(Number.isFinite)
      const min = Math.min(0, ...numbers)
      const max = Math.max(0, ...numbers)
      const zeroY = H - PAD - ((0 - min) / (max - min || 1)) * (H - PAD * 2)
      const barWidth = Math.max(1, (W - PAD * 2) / Math.max(1, hist.length) - 1)
      return {
        lines: [
          { label: 'DIF', color: COLORS.dif, path: linePath(dif, min, max) },
          { label: 'DEA', color: COLORS.dea, path: linePath(dea, min, max) }
        ],
        hist: hist.map((value, index) => ({
          x: PAD + (index / Math.max(1, hist.length - 1)) * (W - PAD * 2) - barWidth / 2,
          y: value >= 0 ? H - PAD - ((value - min) / (max - min || 1)) * (H - PAD * 2) : zeroY,
          height: Math.abs(((value - 0) / (max - min || 1)) * (H - PAD * 2)),
          up: value >= 0
        })),
        latest: [
          ['DIF', dif.at(-1)],
          ['DEA', dea.at(-1)],
          ['MACD', hist.at(-1)]
        ] as Array<[string, number | undefined]>
      }
    }
    if (tab() === 'kdj') {
      const values = kdj(all)
      const k = slice(values.k)
      const d = slice(values.d)
      const j = slice(values.j)
      const numbers = [...k, ...d, ...j]
      const min = Math.min(...numbers)
      const max = Math.max(...numbers)
      return {
        lines: [
          { label: 'K', color: COLORS.k, path: linePath(k, min, max) },
          { label: 'D', color: COLORS.d, path: linePath(d, min, max) },
          { label: 'J', color: COLORS.j, path: linePath(j, min, max) }
        ],
        hist: [],
        latest: [
          ['K', k.at(-1)],
          ['D', d.at(-1)],
          ['J', j.at(-1)]
        ] as Array<[string, number | undefined]>
      }
    }
    if (tab() === 'rsi') {
      const values = rsi(all)
      const line = slice(values)
      return {
        lines: [{ label: 'RSI14', color: COLORS.rsi, path: linePath(line, 0, 100) }],
        hist: [],
        latest: [['RSI14', line.at(-1)]] as Array<[string, number | undefined]>
      }
    }
    const values = boll(all)
    const upper = slice(values.upper)
    const middle = slice(values.middle)
    const lower = slice(values.lower)
    const close = slice(all.map((bar) => bar.close))
    const numbers = [...upper, ...middle, ...lower, ...close].filter(Number.isFinite)
    const min = Math.min(...numbers)
    const max = Math.max(...numbers)
    return {
      lines: [
        { label: 'UPPER', color: COLORS.upper, path: linePath(upper, min, max) },
        { label: 'MID', color: COLORS.middle, path: linePath(middle, min, max) },
        { label: 'LOWER', color: COLORS.lower, path: linePath(lower, min, max) },
        { label: 'CLOSE', color: COLORS.close, path: linePath(close, min, max) }
      ],
      hist: [],
      latest: [
        ['UPPER', upper.at(-1)],
        ['MID', middle.at(-1)],
        ['LOWER', lower.at(-1)]
      ] as Array<[string, number | undefined]>
    }
  })

  return (
    <div class="indicator-backdrop" onClick={() => props.onClose()}>
      <section
        class="indicator-panel"
        role="dialog"
        aria-modal="true"
        aria-label="技术指标"
        onClick={(event) => event.stopPropagation()}
      >
        <header class="indicator__head">
          <div>
            <div class="indicator__eyebrow">本地计算 · 最近 {VISIBLE} 根日 K</div>
            <h2 class="indicator__title">
              {props.name} <code>{props.code.toUpperCase()}</code>
            </h2>
          </div>
          <button class="btn btn--icon btn--bare" title="关闭指标" onClick={() => props.onClose()}>
            <IconClose size={16} />
          </button>
        </header>

        <div class="indicator-tabs">
          <For
            each={
              [
                ['macd', 'MACD'],
                ['kdj', 'KDJ'],
                ['rsi', 'RSI'],
                ['boll', 'BOLL']
              ] as Array<[Tab, string]>
            }
          >
            {([value, label]) => (
              <button
                class="indicator-tab"
                data-active={tab() === value}
                onClick={() => setTab(value)}
              >
                {label}
              </button>
            )}
          </For>
        </div>

        <div class="indicator__body">
          <Show
            when={!loading() && chart()}
            fallback={<div class="indicator__loading">{loading() ? '加载日 K…' : '没有数据'}</div>}
          >
            {(data) => (
              <Show when={!error()} fallback={<div class="indicator__error">{error()}</div>}>
                <svg
                  viewBox={`0 0 ${W} ${H}`}
                  class="indicator__svg"
                  role="img"
                  aria-label="技术指标"
                >
                  <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} class="indicator__axis" />
                  <For each={data().hist}>
                    {(bar) => (
                      <rect
                        x={bar.x}
                        y={bar.y}
                        width={2}
                        height={Math.max(1, bar.height)}
                        class={bar.up ? 'indicator__hist-up' : 'indicator__hist-down'}
                      />
                    )}
                  </For>
                  <For each={data().lines}>
                    {(line) => (
                      <path d={line.path} fill="none" stroke={line.color} stroke-width="1.4" />
                    )}
                  </For>
                </svg>
                <div class="indicator__legend">
                  <For each={data().lines}>
                    {(line) => <span style={{ color: line.color }}>{line.label}</span>}
                  </For>
                </div>
              </Show>
            )}
          </Show>
        </div>

        <div class="indicator__latest">
          <For each={chart()?.latest ?? []}>
            {([label, value]) => (
              <span>
                {label}{' '}
                <strong>
                  {value === undefined || !Number.isFinite(value) ? '—' : fixed(value)}
                </strong>
              </span>
            )}
          </For>
        </div>

        <footer class="indicator__foot">
          <span>MACD(12,26,9) · KDJ(9,3,3) · RSI14 · BOLL(20,2)</span>
          <span>不构成交易建议</span>
        </footer>
      </section>
    </div>
  )
}
