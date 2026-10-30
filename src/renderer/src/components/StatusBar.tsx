/**
 * 底部状态栏：连接状态、数据新鲜度、刷新频率、交易时段。
 */
import { createSignal, For, Show, type JSX } from 'solid-js'
import type { MarketBreadth } from '@shared/types'
import { SESSION_LABEL, marketSession } from '@shared/market'
import { relativeFrom, timeOfDay } from '@shared/format'
import { createInterval } from '../lib/dom'
import { api } from '../lib/ipc'
import {
  exportWatchlist,
  exportWatchlistCsv,
  parseWatchlist,
  parseWatchlistCsv
} from '@shared/watchlist'
import {
  activeQuoteCode,
  appInfo,
  appState,
  importWatchGroups,
  updateSettings,
  watchCodes
} from '../stores/app'
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

export function StatusBar(props: { onOpenShortcuts: () => void }): JSX.Element {
  // 每秒走一次，让「N 秒前」「当前时段」保持鲜活
  const [now, setNow] = createSignal(Date.now())
  const [notice, setNotice] = createSignal<string | null>(null)
  const [breadth, setBreadth] = createSignal<MarketBreadth | null>(null)
  const [format, setFormat] = createSignal<'json' | 'csv'>('json')
  let fileInput: HTMLInputElement | undefined
  createInterval(
    () => setNow(Date.now()),
    () => 1000
  )

  const loadBreadth = async (): Promise<void> => {
    try {
      setBreadth(await api.market.breadth())
    } catch {
      // 涨跌家数是辅助信息，失败静默，不打断状态栏
    }
  }
  createInterval(
    () => void loadBreadth(),
    () => 30_000
  )
  void loadBreadth()

  const exportGroups = (): void => {
    try {
      const csv = format() === 'csv'
      const text = csv ? exportWatchlistCsv(appState.groups) : exportWatchlist(appState.groups)
      const blob = new Blob([text], {
        type: csv ? 'text/csv;charset=utf-8' : 'application/json;charset=utf-8'
      })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `stocklens-watchlist-${new Date().toISOString().slice(0, 10)}.${
        csv ? 'csv' : 'json'
      }`
      anchor.click()
      URL.revokeObjectURL(url)
      setNotice(`已导出 ${appState.groups.length} 个分组（${csv ? 'CSV' : 'JSON'}）`)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
    }
  }

  const importGroups = async (event: Event): Promise<void> => {
    const input = event.currentTarget as HTMLInputElement
    const file = input.files?.[0]
    if (!file) return
    try {
      const text = await file.text()
      const groups = file.name.toLowerCase().endsWith('.csv')
        ? parseWatchlistCsv(text)
        : parseWatchlist(text)
      importWatchGroups(groups)
      setNotice(`已导入 ${groups.length} 个分组`)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
    } finally {
      input.value = ''
    }
  }

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
          <span class="statusbar__text num">
            行情 {timeOfDay(current().time)} · {relativeFrom(lastUpdateAt() || Date.now(), now())}
          </span>
        )}
      </Show>

      <Show when={breadth()}>
        {(value) => (
          <span class="statusbar__text market-breadth">
            涨 <span class="tone-up">{value().up}</span> / 跌{' '}
            <span class="tone-down">{value().down}</span> / 平 {value().flat}
          </span>
        )}
      </Show>

      <div class="statusbar__spacer" />

      <span class="statusbar__text">
        {SESSION_LABEL[session()]} · {appState.groups.length} 组 / {watchCodes().length} 只
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

      <Show when={notice()}>
        <span class="statusbar__text" title={notice() ?? ''}>
          {notice()}
        </span>
      </Show>

      <input
        ref={(element) => {
          fileInput = element
        }}
        class="statusbar__file"
        type="file"
        accept="application/json,.json,text/csv,.csv"
        onChange={(event) => void importGroups(event)}
      />
      <select
        class="statusbar__format"
        value={format()}
        title="导入/导出格式"
        onChange={(event) => setFormat(event.currentTarget.value as 'json' | 'csv')}
      >
        <option value="json">JSON</option>
        <option value="csv">CSV</option>
      </select>
      <button class="statusbar__btn" title="导出自选备份" onClick={exportGroups}>
        导出
      </button>
      <button class="statusbar__btn" title="导入自选备份" onClick={() => fileInput?.click()}>
        导入
      </button>

      <button
        class="statusbar__btn shortcuts-open"
        title="快捷键（?）"
        onClick={() => props.onOpenShortcuts()}
      >
        ?
      </button>
      <span class="statusbar__text num">v{appInfo()?.version ?? '0.0.0'}</span>
    </footer>
  )
}
