/**
 * 底部状态栏：连接状态、数据新鲜度、刷新频率、交易时段。
 */
import { createSignal, For, Show, type JSX } from 'solid-js'
import { SESSION_LABEL, marketSession } from '@shared/market'
import { relativeFrom, timeOfDay } from '@shared/format'
import { createInterval } from '../lib/dom'
import { activeQuoteCode, appInfo, appState, updateSettings, watchCodes } from '../stores/app'
import { connection, lastUpdateAt, quoteOf, refreshQuotes, streamError } from '../stores/quotes'
import { IconRefresh } from './Icons'

const INTERVAL_OPTIONS = [
  { value: 1000, label: '1s' },
  { value: 3000, label: '3s' },
  { value: 5000, label: '5s' },
  { value: 10_000, label: '10s' }
]

const STATUS_TEXT: Record<string, string> = {
  idle: '未订阅',
  connecting: '连接中',
  live: '实时',
  error: '连接异常'
}

export function StatusBar(): JSX.Element {
  // 每秒走一次，让「N 秒前」「当前时段」保持鲜活
  const [now, setNow] = createSignal(Date.now())
  createInterval(
    () => setNow(Date.now()),
    () => 1000
  )

  const quote = () => quoteOf(activeQuoteCode())
  const session = () => marketSession(new Date(now()))

  return (
    <footer class="statusbar">
      <div class="statusbar__group">
        <span
          class="dot"
          classList={{
            'dot--live': connection() === 'live',
            'dot--error': connection() === 'error',
            'dot--connecting': connection() === 'connecting'
          }}
        />
        <span class="statusbar__text">{STATUS_TEXT[connection()] ?? connection()}</span>
      </div>

      <Show when={streamError()}>
        <span class="statusbar__text statusbar__error" title={streamError() ?? ''}>
          {streamError()}
        </span>
      </Show>

      <Show when={quote()}>
        {(current) => (
          <>
            <span class="statusbar__text num">
              行情 {timeOfDay(current().time)} · {relativeFrom(lastUpdateAt() || Date.now(), now())}
            </span>
            <span class="statusbar__text">延迟 {current().receivedAt ? '约 3s' : '—'}</span>
          </>
        )}
      </Show>

      <div class="statusbar__spacer" />

      <span class="statusbar__text">
        {SESSION_LABEL[session()]} · 自选 {appState.watchlist.length} 只
      </span>

      <div class="statusbar__group">
        <span class="statusbar__text">刷新</span>
        <For each={INTERVAL_OPTIONS}>
          {(option) => (
            <button
              class="statusbar__btn"
              data-active={appState.settings.refreshInterval === option.value}
              onClick={() => updateSettings({ refreshInterval: option.value })}
              title={`每 ${option.label} 刷新一次`}
            >
              {option.label}
            </button>
          )}
        </For>
      </div>

      <button
        class="statusbar__btn"
        title="立即刷新"
        onClick={() => void refreshQuotes(watchCodes())}
      >
        <IconRefresh size={11} />
      </button>

      <span class="statusbar__text num">v{appInfo()?.version ?? '0.0.0'}</span>
    </footer>
  )
}
