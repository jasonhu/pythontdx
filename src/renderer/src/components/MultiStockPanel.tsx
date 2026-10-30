/**
 * 多股同列：当前自选分组最多 6 只，可切换 60 根日 K / 当日分时。
 *
 * 纯展示，不引入第二套数据源；点击卡片切换主图股票。
 */
import { createSignal, For, onCleanup, onMount, Show, type JSX } from 'solid-js'
import { fixed, signedPct } from '@shared/format'
import { activeItems, appState } from '../stores/app'
import { api, errorMessage } from '../lib/ipc'
import { IconClose } from './Icons'

interface MultiStockPanelProps {
  onClose: () => void
  onSelect: (code: string) => void
}

type Mode = 'day' | 'minute'

interface Card {
  code: string
  name: string
  path: string
  changePct: number
  close: number
  date: string
  hasData: boolean
  error?: string
}

const W = 240
const H = 70
const PAD = 5

function sparkline(values: number[]): string {
  if (values.length < 2) return ''
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  return values
    .map((value, index) => {
      const x = PAD + (index / (values.length - 1)) * (W - PAD * 2)
      const y = H - PAD - ((value - min) / span) * (H - PAD * 2)
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`
    })
    .join(' ')
}

export function MultiStockPanel(props: MultiStockPanelProps): JSX.Element {
  const [mode, setMode] = createSignal<Mode>('day')
  const [cards, setCards] = createSignal<Card[]>([])
  const [loading, setLoading] = createSignal(true)
  const [error, setError] = createSignal<string | null>(null)
  let requestId = 0

  const load = async (nextMode: Mode): Promise<void> => {
    const current = ++requestId
    setMode(nextMode)
    setLoading(true)
    setError(null)
    const items = activeItems().slice(0, 6)
    try {
      const loaded = await Promise.all(
        items.map(async (item): Promise<Card> => {
          try {
            if (nextMode === 'day') {
              const series = await api.trend.kline({ code: item.code, period: 'day', count: 60 })
              const bars = series.bars
              const last = bars[bars.length - 1]
              const previous = bars[bars.length - 2]
              const close = last?.close ?? 0
              const changePct =
                previous && previous.close !== 0
                  ? ((close - previous.close) / previous.close) * 100
                  : 0
              return {
                code: item.code,
                name: item.name,
                path: sparkline(bars.map((bar) => bar.close)),
                changePct,
                close,
                date: last?.date ?? '',
                hasData: bars.length > 0
              }
            }
            const trend = await api.trend.minute(item.code)
            const points = trend.points
            const close = points[points.length - 1]?.price ?? 0
            const changePct =
              trend.prevClose !== 0 ? ((close - trend.prevClose) / trend.prevClose) * 100 : 0
            return {
              code: item.code,
              name: item.name,
              path: sparkline(points.map((point) => point.price)),
              changePct,
              close,
              date: trend.date,
              hasData: points.length > 0
            }
          } catch (cause) {
            return {
              code: item.code,
              name: item.name,
              path: '',
              changePct: 0,
              close: 0,
              date: '',
              hasData: false,
              error: errorMessage(cause)
            }
          }
        })
      )
      if (current === requestId) setCards(loaded)
    } catch (cause) {
      if (current === requestId) setError(errorMessage(cause))
    } finally {
      if (current === requestId) setLoading(false)
    }
  }

  onMount(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') props.onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    onCleanup(() => window.removeEventListener('keydown', onKeyDown))
    void load('day')
  })

  return (
    <div class="multi-backdrop" onClick={() => props.onClose()}>
      <section
        class="multi-panel"
        role="dialog"
        aria-modal="true"
        aria-label="多股同列"
        onClick={(event) => event.stopPropagation()}
      >
        <header class="multi__head">
          <div>
            <div class="multi__eyebrow">
              {mode() === 'day' ? '60 根日 K' : '当日分时'} · 当前分组
            </div>
            <h2 class="multi__title">多股同列</h2>
          </div>
          <div class="multi__modes">
            <button
              class="multi__mode"
              data-active={mode() === 'day'}
              onClick={() => void load('day')}
            >
              日 K
            </button>
            <button
              class="multi__mode multi-minute-tab"
              data-active={mode() === 'minute'}
              onClick={() => void load('minute')}
            >
              分时
            </button>
          </div>
          <span class="multi__group">
            {appState.groups.find((group) => group.id === appState.activeGroupId)?.name}
          </span>
          <button
            class="btn btn--icon btn--bare"
            title="关闭多股同列"
            onClick={() => props.onClose()}
          >
            <IconClose size={16} />
          </button>
        </header>

        <div class="multi__body">
          <Show
            when={!loading()}
            fallback={<div class="multi__empty">加载 {activeItems().length} 只…</div>}
          >
            <Show when={!error()} fallback={<div class="multi__error">{error()}</div>}>
              <Show
                when={cards().length > 0}
                fallback={<div class="multi__empty">当前分组没有股票</div>}
              >
                <div class="multi__grid">
                  <For each={cards()}>
                    {(card) => (
                      <button
                        class="multi-card"
                        classList={{ 'multi-card--down': card.changePct < 0 }}
                        onClick={() => {
                          props.onSelect(card.code)
                          props.onClose()
                        }}
                      >
                        <div class="multi-card__head">
                          <span class="multi-card__name">{card.name}</span>
                          <span class="multi-card__code num">{card.code.toUpperCase()}</span>
                        </div>
                        <Show
                          when={card.hasData}
                          fallback={<div class="multi-card__error">{card.error ?? '暂无数据'}</div>}
                        >
                          <svg
                            viewBox={`0 0 ${W} ${H}`}
                            class="multi-card__spark"
                            aria-hidden="true"
                          >
                            <path d={card.path} />
                          </svg>
                          <div class="multi-card__foot">
                            <span class="num">{fixed(card.close)}</span>
                            <span
                              classList={{
                                'tone-down': card.changePct < 0,
                                'tone-up': card.changePct > 0
                              }}
                            >
                              {signedPct(card.changePct)}
                            </span>
                            <span>{card.date}</span>
                          </div>
                        </Show>
                      </button>
                    )}
                  </For>
                </div>
              </Show>
            </Show>
          </Show>
        </div>

        <footer class="multi__foot">
          <span>点击卡片切换主图</span>
          <span>最多 6 只 · {mode() === 'day' ? '0x052d 日 K' : '当日分时'}</span>
        </footer>
      </section>
    </div>
  )
}
