/**
 * 多股同列：当前自选分组最多 6 只，拉 60 根日 K 画迷你走势。
 *
 * 纯展示，不引入第二套数据源；点击卡片切换主图股票。
 */
import { createSignal, For, onCleanup, onMount, Show, type JSX } from 'solid-js'
import type { KLineBar } from '@shared/types'
import { fixed, signedPct } from '@shared/format'
import { activeItems, appState } from '../stores/app'
import { api, errorMessage } from '../lib/ipc'
import { IconClose } from './Icons'

interface MultiStockPanelProps {
  onClose: () => void
  onSelect: (code: string) => void
}

interface Card {
  code: string
  name: string
  bars: KLineBar[]
  path: string
  changePct: number
  close: number
  error?: string
}

const W = 240
const H = 70
const PAD = 5

function sparkline(bars: KLineBar[]): string {
  if (bars.length < 2) return ''
  const values = bars.map((bar) => bar.close)
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
  const [cards, setCards] = createSignal<Card[]>([])
  const [loading, setLoading] = createSignal(true)
  const [error, setError] = createSignal<string | null>(null)
  let requestId = 0

  const load = async (): Promise<void> => {
    const current = ++requestId
    setLoading(true)
    setError(null)
    const items = activeItems().slice(0, 6)
    try {
      const loaded = await Promise.all(
        items.map(async (item): Promise<Card> => {
          try {
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
              bars,
              path: sparkline(bars),
              changePct,
              close
            }
          } catch (cause) {
            return {
              code: item.code,
              name: item.name,
              bars: [],
              path: '',
              changePct: 0,
              close: 0,
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
    void load()
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
            <div class="multi__eyebrow">60 根日 K · 当前分组</div>
            <h2 class="multi__title">多股同列</h2>
          </div>
          <span class="multi__group">
            {appState.groups.find((g) => g.id === appState.activeGroupId)?.name}
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
            fallback={<div class="multi__empty">加载 {activeItems().length} 只日 K…</div>}
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
                          when={card.bars.length > 0}
                          fallback={
                            <div class="multi-card__error">{card.error ?? '暂无 K 线'}</div>
                          }
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
                            <span>{card.bars[card.bars.length - 1]?.date}</span>
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
          <span>最多 6 只 · 数据来自 0x052d</span>
        </footer>
      </section>
    </div>
  )
}
