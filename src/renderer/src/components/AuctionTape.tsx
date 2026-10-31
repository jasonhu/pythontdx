/**
 * 集合竞价过程（0x056a）。
 *
 * 当日每 3 秒拉快照；历史日期优先读本地归档（服务器只保留最近交易日），
 * 没有归档才回退实时查询。归档写入数据湖 `lake/auction/trade_date=.../`，
 * 虚拟匹配量不是真实成交，只用于观察竞价过程。
 */
import { createEffect, createSignal, For, onCleanup, onMount, Show, type JSX } from 'solid-js'
import type { AuctionPoint } from '@shared/types'
import { fixed, thousands } from '@shared/format'
import { api, errorMessage } from '../lib/ipc'

interface AuctionTapeProps {
  code: string
}

type AuctionSource = 'live' | 'archive' | 'none'

const REFRESH_MS = 3000

export function AuctionTape(props: AuctionTapeProps): JSX.Element {
  const [rows, setRows] = createSignal<AuctionPoint[]>([])
  const [loading, setLoading] = createSignal(true)
  const [error, setError] = createSignal<string | null>(null)
  const [date, setDate] = createSignal('')
  const [source, setSource] = createSignal<AuctionSource>('live')
  const [archiveBusy, setArchiveBusy] = createSignal(false)
  const [archiveNote, setArchiveNote] = createSignal<string | null>(null)
  let requestId = 0

  const load = async (code: string, tradingDate = date()): Promise<void> => {
    const current = ++requestId
    setLoading(true)
    try {
      if (tradingDate) {
        try {
          const archive = await api.auction.archiveRead(code, tradingDate)
          if (current !== requestId) return
          if (archive.found && archive.points.length > 0) {
            setRows(archive.points)
            setSource('archive')
            setError(null)
            return
          }
        } catch (cause) {
          if (current !== requestId) return
          // 归档损坏不应该挡住实时兜底，把原因留在工具栏下方。
          setArchiveNote(`本地归档读取失败：${errorMessage(cause)}`)
        }
      }
      const data = await api.auction.series(code, tradingDate || undefined)
      if (current !== requestId) return
      setRows(data)
      setSource(data.length > 0 ? 'live' : 'none')
      setError(null)
    } catch (cause) {
      if (current !== requestId) return
      setRows([])
      setSource('none')
      setError(errorMessage(cause))
    } finally {
      if (current === requestId) setLoading(false)
    }
  }

  createEffect(() => {
    const tradingDate = date()
    void load(props.code, tradingDate)
  })

  onMount(() => {
    const timer = window.setInterval(() => {
      if (!date()) void load(props.code, '')
    }, REFRESH_MS)
    onCleanup(() => window.clearInterval(timer))
  })

  const previousTradingDate = (): string => {
    const value = new Date()
    value.setDate(value.getDate() - 1)
    while (value.getDay() === 0 || value.getDay() === 6) value.setDate(value.getDate() - 1)
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(
      value.getDate()
    ).padStart(2, '0')}`
  }

  const changeDate = (value: string): void => {
    setArchiveNote(null)
    setDate(value)
  }

  const saveArchive = async (): Promise<void> => {
    if (archiveBusy() || loading()) return
    setArchiveBusy(true)
    setArchiveNote(null)
    try {
      const result = await api.auction.archiveSave(props.code, date() || undefined)
      setArchiveNote(`已归档 ${result.tradeDate} · ${result.rows} 点`)
      if (date() && result.tradeDate === date()) {
        setRows(result.points)
        setSource('archive')
      }
    } catch (cause) {
      setArchiveNote(`归档失败：${errorMessage(cause)}`)
    } finally {
      setArchiveBusy(false)
    }
  }

  const sourceLabel = (): string => {
    if (source() === 'archive') return '本地归档'
    if (date()) return '实时查询'
    return '每 3 秒'
  }

  return (
    <div class="auction">
      <div class="auction__meta">
        <span>{loading() ? '刷新中…' : `${rows().length} 点`}</span>
        <span>
          {sourceLabel()}
          {date() ? ` · ${date()}` : ''}
        </span>
      </div>

      <div class="auction__toolbar">
        <input
          class="auction__date"
          type="date"
          value={date()}
          aria-label="竞价日期"
          onChange={(event) => changeDate(event.currentTarget.value)}
        />
        <Show
          when={date()}
          fallback={
            <button class="auction__today" onClick={() => changeDate(previousTradingDate())}>
              历史
            </button>
          }
        >
          <button class="auction__today" onClick={() => changeDate('')}>
            回今天
          </button>
        </Show>
        <button
          class="auction__today auction__archive"
          disabled={archiveBusy() || loading() || rows().length === 0}
          title="写入本地数据湖，供服务器不再保留该日期后回看"
          onClick={() => void saveArchive()}
        >
          {archiveBusy() ? '归档中…' : '归档'}
        </button>
      </div>

      <Show when={archiveNote()}>{(message) => <div class="auction__note">{message()}</div>}</Show>

      <Show when={error()}>
        {(message) => (
          <div class="auction__error" role="alert">
            {message()}
            <button class="auction__retry" onClick={() => void load(props.code)}>
              重试
            </button>
          </div>
        )}
      </Show>

      <div class="auction__head">
        <span>时间</span>
        <span class="auction__num">价格</span>
        <span class="auction__num">匹配</span>
        <span class="auction__num">未匹配</span>
      </div>

      <div class="auction__rows">
        <For each={rows()}>
          {(point) => (
            <div class="auction__row" title={`${point.time} · 虚拟撮合快照`}>
              <span class="auction__time num">{point.time}</span>
              <span class="auction__num">{fixed(point.price)}</span>
              <span class="auction__num">{thousands(point.matchedVolume)}</span>
              <span
                class="auction__num"
                classList={{
                  'tone-up': point.unmatchedDirection > 0,
                  'tone-down': point.unmatchedDirection < 0
                }}
              >
                {thousands(point.unmatchedVolume)}
              </span>
            </div>
          )}
        </For>
      </div>

      <Show when={!loading() && rows().length === 0 && !error()}>
        <div class="auction__empty">
          {date() ? '该日期没有实时数据，也没有本地归档；通达信只保留最近交易日' : '暂无竞价数据'}
        </div>
      </Show>

      <div class="auction__foot">09:15–09:25 · 虚拟匹配量，不是成交 · 可归档到本地</div>
    </div>
  )
}
