/**
 * 应用根组件：负责布局、主题注入和行情订阅的启动。
 *
 * 布局用 CSS Grid 划成「标题栏 / 侧栏 + 工作区 / 状态栏」三块，
 * 这里只做结构，具体样式在 styles/app.css。
 */
import { createEffect, onMount, Show, type JSX } from 'solid-js'
import type { Quote } from '@shared/types'
import { ChartPanel } from './components/ChartPanel'
import { EmptyState } from './components/EmptyState'
import { OrderBook } from './components/OrderBook'
import { QuoteHeader } from './components/QuoteHeader'
import { Sidebar } from './components/Sidebar'
import { StatsGrid } from './components/StatsGrid'
import { StatusBar } from './components/StatusBar'
import { TitleBar } from './components/TitleBar'
import { activeQuoteCode, appReady, appState, bootstrapAppState, watchCodes } from './stores/app'
import { createQuoteStream, quoteOf } from './stores/quotes'
import { createSparklineLoader } from './stores/sparklines'

export default function App(): JSX.Element {
  onMount(() => {
    void bootstrapAppState()
  })

  // 主题：把设置写进 <html data-theme>，CSS 变量会自动切换
  createEffect(() => {
    document.documentElement.dataset.theme = appState.settings.theme
  })

  // 行情推送：自选股与刷新间隔变化时，自动向主进程重新订阅
  createQuoteStream(
    () => (appReady() ? watchCodes() : []),
    () => appState.settings.refreshInterval
  )

  // 自选股行内迷你走势图：并发受限地补齐并定期刷新
  createSparklineLoader(() => (appReady() ? watchCodes() : []))

  const activeQuote = (): Quote | undefined => quoteOf(activeQuoteCode())

  return (
    <div class="app" classList={{ 'app--empty': !activeQuote() }}>
      <TitleBar />
      <Sidebar />

      {/* 主区只有两块：行情头部 + 图表。图表用 flex 吃掉全部剩余高度 */}
      <main class="workspace">
        <Show when={activeQuote()} fallback={<EmptyState />}>
          {(quote) => (
            <>
              <QuoteHeader quote={quote()} />
              <ChartPanel code={quote().code} />
            </>
          )}
        </Show>
      </main>

      {/* 右栏：盘口在上（自适应撑开），指标在下（内容高度） */}
      <aside class="rail">
        <Show when={activeQuote()}>
          {(quote) => (
            <>
              <section class="card panel panel--book">
                <div class="panel__head">
                  <span class="card__title">五档盘口</span>
                  <span class="statusbar__text">单位：手</span>
                </div>
                <div class="panel__body panel__body--fill">
                  <OrderBook quote={quote()} />
                </div>
              </section>

              <section class="card panel panel--stats">
                <div class="panel__head">
                  <span class="card__title">关键指标</span>
                  <span class="statusbar__text">{quote().market === 'HK' ? '港股' : 'A 股'}</span>
                </div>
                <div class="panel__body">
                  <StatsGrid quote={quote()} />
                </div>
              </section>
            </>
          )}
        </Show>
      </aside>

      <StatusBar />
    </div>
  )
}
