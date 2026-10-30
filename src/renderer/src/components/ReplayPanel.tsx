/**
 * 日 K 复盘：只显示当前回放日期之前的数据，逐根前进。
 *
 * 复用主图的 KLineChart；回放切片在渲染层完成，不请求未来数据。
 */
import { createEffect, createMemo, createSignal, onCleanup, Show, type JSX } from 'solid-js'
import type { KLineBar, KLineSeries } from '@shared/types'
import { fixed, signedPct, thousands } from '@shared/format'
import { api, errorMessage } from '../lib/ipc'
import { KLineChart } from './KLineChart'
import { IconClose } from './Icons'

interface ReplayPanelProps {
  code: string
  name: string
  onClose: () => void
}

export function ReplayPanel(props: ReplayPanelProps): JSX.Element {
  const [bars, setBars] = createSignal<KLineBar[]>([])
  const [index, setIndex] = createSignal(0)
  const [playing, setPlaying] = createSignal(false)
  const [loading, setLoading] = createSignal(true)
  const [error, setError] = createSignal<string | null>(null)
  let requestId = 0

  const load = async (): Promise<void> => {
    const current = ++requestId
    setLoading(true)
    setError(null)
    try {
      const series = await api.trend.kline({ code: props.code, period: 'day', count: 320 })
      if (current !== requestId) return
      setBars(series.bars)
      setIndex(Math.max(0, Math.min(series.bars.length - 1, Math.floor(series.bars.length * 0.7))))
      setPlaying(false)
    } catch (cause) {
      if (current === requestId) setError(errorMessage(cause))
    } finally {
      if (current === requestId) setLoading(false)
    }
  }

  createEffect(() => {
    if (!props.code) return
    void load()
  })

  createEffect(() => {
    if (!playing()) return
    const timer = window.setInterval(() => {
      setIndex((value) => {
        const last = bars().length - 1
        if (value >= last) {
          setPlaying(false)
          return value
        }
        return value + 1
      })
    }, 700)
    onCleanup(() => window.clearInterval(timer))
  })

  const current = createMemo(() => bars()[index()])
  const previous = createMemo(() => bars()[index() - 1])
  const series = createMemo<KLineSeries>(() => ({
    code: props.code,
    period: 'day',
    bars: bars().slice(0, index() + 1)
  }))
  const changePct = createMemo(() => {
    const bar = current()
    const prev = previous()
    if (!bar || !prev || prev.close === 0) return 0
    return ((bar.close - prev.close) / prev.close) * 100
  })

  const step = (delta: number): void => {
    setPlaying(false)
    setIndex((value) => Math.max(0, Math.min(bars().length - 1, value + delta)))
  }

  return (
    <div class="replay-backdrop" onClick={() => props.onClose()}>
      <section
        class="replay-panel"
        role="dialog"
        aria-modal="true"
        aria-label="日 K 复盘"
        onClick={(event) => event.stopPropagation()}
      >
        <header class="replay__head">
          <div>
            <div class="replay__eyebrow">日 K 回放 · 只使用当前日期之前的数据</div>
            <h2 class="replay__title">
              {props.name} <code>{props.code.toUpperCase()}</code>
            </h2>
          </div>
          <button class="btn btn--icon btn--bare" title="关闭复盘" onClick={() => props.onClose()}>
            <IconClose size={16} />
          </button>
        </header>

        <Show when={error()}>
          {(message) => (
            <div class="replay__error" role="alert">
              {message()}
            </div>
          )}
        </Show>

        <Show
          when={!loading() && current()}
          fallback={
            <div class="replay__loading">{loading() ? '加载日 K…' : '没有可回放的数据'}</div>
          }
        >
          {(bar) => (
            <>
              <div class="replay__quotes">
                <span class="replay__date">{bar().date}</span>
                <span class="replay__price num">{fixed(bar().close)}</span>
                <span
                  class="replay__change num"
                  classList={{
                    'tone-up': changePct() > 0,
                    'tone-down': changePct() < 0
                  }}
                >
                  {signedPct(changePct())}
                </span>
                <span class="replay__ohlc">
                  开 {fixed(bar().open)} · 高 {fixed(bar().high)} · 低 {fixed(bar().low)}
                </span>
                <span class="replay__ohlc">量 {thousands(bar().volume)} 手</span>
              </div>

              <div class="replay__chart">
                <KLineChart series={series()} />
              </div>

              <div class="replay__controls">
                <button class="btn" onClick={() => step(-1)} disabled={index() <= 0 || playing()}>
                  上一步
                </button>
                <button
                  class="btn btn--primary replay__play"
                  onClick={() => {
                    if (index() >= bars().length - 1) setIndex(0)
                    setPlaying((value) => !value)
                  }}
                >
                  {playing() ? '暂停' : '播放'}
                </button>
                <button
                  class="btn"
                  onClick={() => step(1)}
                  disabled={index() >= bars().length - 1 || playing()}
                >
                  下一步
                </button>
                <input
                  class="replay__slider"
                  type="range"
                  min="0"
                  max={Math.max(0, bars().length - 1)}
                  value={index()}
                  aria-label="回放位置"
                  onInput={(event) => {
                    setPlaying(false)
                    setIndex(Number(event.currentTarget.value))
                  }}
                />
                <span class="replay__position num">
                  {index() + 1} / {bars().length}
                </span>
              </div>
            </>
          )}
        </Show>

        <footer class="replay__foot">
          <span>回放切片只喂给渲染层，不请求未来 K 线</span>
          <span>播放速度 700ms/根</span>
        </footer>
      </section>
    </div>
  )
}
