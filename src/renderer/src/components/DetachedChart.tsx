/** 独立 K 线窗口：只复用图表卡片，不加载侧栏/状态栏。 */
import { createEffect, createSignal, onMount, type JSX } from 'solid-js'
import type { Quote } from '@shared/types'
import { api } from '../lib/ipc'
import { appState, bootstrapAppState } from '../stores/app'
import { ChartPanel } from './ChartPanel'

export function DetachedChart(props: { code: string }): JSX.Element {
  const [quote, setQuote] = createSignal<Quote | null>(null)

  onMount(() => {
    void bootstrapAppState()
    void api.quote
      .snapshot([props.code])
      .then((list) => setQuote(list[0] ?? null))
      .catch(() => undefined)
  })

  createEffect(() => {
    document.documentElement.dataset.theme = appState.settings.theme
    document.documentElement.dataset.platform = 'detached'
  })

  return (
    <div class="detached-window">
      <header class="detached-window__head">
        <strong>{quote()?.name ?? props.code.toUpperCase()}</strong>
        <code>{props.code.toUpperCase()}</code>
        <span class="detached-window__hint">独立 K 线窗口</span>
      </header>
      <div class="detached-window__chart">
        <ChartPanel
          code={props.code}
          detached
          onOpenReplay={() => undefined}
          onOpenFormula={() => undefined}
          onOpenIndicators={() => undefined}
        />
      </div>
    </div>
  )
}
