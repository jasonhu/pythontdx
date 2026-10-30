/**
 * 应用根组件：负责布局、主题注入和行情订阅的启动。
 *
 * 布局用 CSS Grid 划成「标题栏 / 侧栏 + 工作区 / 状态栏」三块，
 * 这里只做结构，具体样式在 styles/app.css。
 */
import { createEffect, createSignal, Match, onMount, Show, Switch, type JSX } from 'solid-js'
import type { Quote } from '@shared/types'
import { AuctionTape } from './components/AuctionTape'
import { ChartPanel } from './components/ChartPanel'
import { EmptyState } from './components/EmptyState'
import { MoneyFlow } from './components/MoneyFlow'
import { OrderBook } from './components/OrderBook'
import { QuoteHeader } from './components/QuoteHeader'
import { RankingPanel } from './components/RankingPanel'
import { Sidebar } from './components/Sidebar'
import { StatsGrid } from './components/StatsGrid'
import { StatusBar } from './components/StatusBar'
import { TitleBar } from './components/TitleBar'
import { TradeTape } from './components/TradeTape'
import {
  activeQuoteCode,
  appReady,
  appState,
  bootstrapAppState,
  setActiveCode,
  watchCodes
} from './stores/app'
import { applyQuotes, createQuoteStream, quoteOf } from './stores/quotes'
import { createSparklineLoader } from './stores/sparklines'

export default function App(): JSX.Element {
  const [rankingOpen, setRankingOpen] = createSignal(false)
  const [railTab, setRailTab] = createSignal<'book' | 'tape' | 'flow' | 'auction'>('book')

  onMount(() => {
    void bootstrapAppState()
  })

  // 主题：把设置写进 <html data-theme>，CSS 变量会自动切换
  createEffect(() => {
    document.documentElement.dataset.theme = appState.settings.theme
  })

  // 行情推送：自选股 + 当前选中股（排行榜点进来的股票不在自选里，也要能刷新）
  const quoteCodes = (): string[] => {
    if (!appReady()) return []
    const active = activeQuoteCode()
    return active ? [...new Set([...watchCodes(), active])] : watchCodes()
  }

  createQuoteStream(quoteCodes, () => appState.settings.refreshInterval)

  // 自选股行内迷你走势图：并发受限地补齐并定期刷新
  createSparklineLoader(() => (appReady() ? watchCodes() : []))

  const activeQuote = (): Quote | undefined => quoteOf(activeQuoteCode())

  return (
    <div class="app" classList={{ 'app--empty': !activeQuote() }}>
      <TitleBar />
      <Sidebar onOpenRanking={() => setRankingOpen(true)} />

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
                <div class="panel__head panel__head--tabs">
                  <div class="rail-tabs" role="tablist" aria-label="盘口与成交">
                    <button
                      class="rail-tab rail-tab--book"
                      classList={{ 'rail-tab--active': railTab() === 'book' }}
                      role="tab"
                      aria-selected={railTab() === 'book'}
                      onClick={() => setRailTab('book')}
                    >
                      五档盘口
                    </button>
                    <button
                      class="rail-tab rail-tab--tape"
                      classList={{ 'rail-tab--active': railTab() === 'tape' }}
                      role="tab"
                      aria-selected={railTab() === 'tape'}
                      onClick={() => setRailTab('tape')}
                    >
                      成交明细
                    </button>
                    <button
                      class="rail-tab rail-tab--flow"
                      classList={{ 'rail-tab--active': railTab() === 'flow' }}
                      role="tab"
                      aria-selected={railTab() === 'flow'}
                      onClick={() => setRailTab('flow')}
                    >
                      资金流
                    </button>
                    <button
                      class="rail-tab rail-tab--auction"
                      classList={{ 'rail-tab--active': railTab() === 'auction' }}
                      role="tab"
                      aria-selected={railTab() === 'auction'}
                      onClick={() => setRailTab('auction')}
                    >
                      竞价
                    </button>
                  </div>
                  <span class="statusbar__text">
                    {railTab() === 'book'
                      ? '手'
                      : railTab() === 'tape'
                        ? '60 笔'
                        : railTab() === 'flow'
                          ? '5 日'
                          : '快照'}
                  </span>
                </div>
                <div class="panel__body panel__body--fill">
                  <Switch fallback={<OrderBook quote={quote()} />}>
                    <Match when={railTab() === 'tape'}>
                      <TradeTape code={quote().code} />
                    </Match>
                    <Match when={railTab() === 'flow'}>
                      <MoneyFlow code={quote().code} />
                    </Match>
                    <Match when={railTab() === 'auction'}>
                      <AuctionTape code={quote().code} />
                    </Match>
                  </Switch>
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

      <Show when={rankingOpen()}>
        <RankingPanel
          onClose={() => setRankingOpen(false)}
          onSelect={(quote) => {
            // 排行里的股票通常不在自选：先塞进行情 store，再让 active code 进入订阅
            applyQuotes([quote])
            setActiveCode(quote.code)
            setRankingOpen(false)
          }}
        />
      </Show>
    </div>
  )
}
