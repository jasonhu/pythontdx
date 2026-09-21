/**
 * 行情数据流。
 *
 * 数据方向是「主进程推、渲染进程收」：
 *   渲染层只声明自己关心哪些代码、多久刷一次，
 *   真正的定时器和网络请求都在主进程（见 src/main/services/poller.ts）。
 */
import { createEffect, createSignal, onCleanup, type Accessor } from 'solid-js'
import { createStore } from 'solid-js/store'
import type { ConnectionStatus, Quote, QuoteUpdate } from '@shared/types'
import { api, errorMessage } from '../lib/ipc'

const [quoteMap, setQuoteMap] = createStore<Record<string, Quote>>({})
const [connection, setConnection] = createSignal<ConnectionStatus>('idle')
const [lastUpdateAt, setLastUpdateAt] = createSignal(0)
const [streamError, setStreamError] = createSignal<string | null>(null)

export { quoteMap, connection, lastUpdateAt, streamError }

/** 取某只股票的行情快照 */
export function quoteOf(code: string | null | undefined): Quote | undefined {
  return code ? quoteMap[code] : undefined
}

/** 批量写入（主进程推送的一帧） */
export function applyQuotes(quotes: Quote[]): void {
  for (const quote of quotes) {
    setQuoteMap(quote.code, quote)
  }
}

/**
 * 订阅主进程推送。必须在组件的响应式作用域内调用一次。
 *
 * @param codes      关心的代码列表（响应式）
 * @param intervalMs 期望的刷新间隔（响应式）
 */
export function createQuoteStream(codes: Accessor<string[]>, intervalMs: Accessor<number>): void {
  const dispose = api.quote.onUpdate((update: QuoteUpdate) => {
    setLastUpdateAt(update.at)

    if (update.error) {
      // 失败时保留上一帧数据，只把状态标记为异常
      setStreamError(update.error)
      setConnection('error')
      return
    }

    setStreamError(null)
    applyQuotes(update.quotes)
    setConnection('live')
  })

  onCleanup(dispose)

  createEffect(() => {
    const list = codes()
    const interval = intervalMs()

    if (list.length === 0) {
      void api.quote.unsubscribe()
      setConnection('idle')
      return
    }

    setConnection((previous) => (previous === 'live' ? previous : 'connecting'))
    void api.quote.subscribe(list, interval).catch((error) => {
      setStreamError(errorMessage(error))
      setConnection('error')
    })
  })
}

/** 手动刷新一帧（状态栏的刷新按钮） */
export async function refreshQuotes(codes: string[]): Promise<void> {
  if (codes.length === 0) return
  try {
    applyQuotes(await api.quote.snapshot(codes))
    setStreamError(null)
    setConnection('live')
    setLastUpdateAt(Date.now())
  } catch (error) {
    setStreamError(errorMessage(error))
    setConnection('error')
  }
}
