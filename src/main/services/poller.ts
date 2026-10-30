/**
 * 行情轮询器。
 *
 * 为什么把定时器放在主进程而不是渲染进程？
 *  1. 渲染进程可能因为窗口最小化被 Chromium 节流，setInterval 会漂移；
 *  2. 主进程可以统一做「窗口不可见就停拉」「非交易时段降频」这类优化；
 *  3. 将来要多窗口/托盘常驻时，只需要一个数据源。
 */
import type { Quote, QuoteUpdate } from '@shared/types'
import { isTradingNow } from '@shared/market'
import { fetchQuotes } from './tdx'

/** 非交易时段的降频下限：再快也没意义，还容易被上游限流 */
const IDLE_MIN_INTERVAL = 30_000

export interface QuotePollerOptions {
  /** 每拉到一帧（或失败）时回调 */
  emit: (update: QuoteUpdate) => void
  /** 返回 false 时跳过本次拉取（例如窗口被最小化） */
  canFetch?: () => boolean
}

export class QuotePoller {
  private codes: string[] = []
  private intervalMs = 3000
  private timer: NodeJS.Timeout | null = null
  private inFlight = false
  private latest: Quote[] = []
  private abortController: AbortController | null = null

  constructor(private readonly options: QuotePollerOptions) {}

  /** 最近一次成功拉取的数据 */
  get snapshot(): Quote[] {
    return this.latest
  }

  /**
   * 更新订阅集合。代码列表没变化时保持当前节奏，避免频繁重建定时器。
   */
  setSubscription(codes: string[], intervalMs: number): void {
    const nextCodes = [...new Set(codes.map((code) => code.trim().toLowerCase()).filter(Boolean))]
    const codesChanged = nextCodes.join(',') !== this.codes.join(',')
    const intervalChanged = intervalMs !== this.intervalMs

    this.codes = nextCodes
    this.intervalMs = Math.max(1000, intervalMs)

    if (this.codes.length === 0) {
      this.stop()
      return
    }

    if (codesChanged) void this.refreshNow()
    if (codesChanged || intervalChanged || !this.timer) this.schedule()
  }

  /** 立即拉取一帧（用于「手动刷新」和订阅变更后的首帧） */
  async refreshNow(): Promise<Quote[]> {
    if (this.codes.length === 0) return this.latest
    await this.tick(true)
    return this.latest
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.abortController?.abort()
    this.abortController = null
  }

  /**
   * 交易时段用用户设置的间隔；盘后自动降频到 30 秒以上。
   */
  private effectiveInterval(): number {
    return isTradingNow() ? this.intervalMs : Math.max(this.intervalMs * 10, IDLE_MIN_INTERVAL)
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      void this.tick(false)
    }, this.effectiveInterval())
  }

  private async tick(force: boolean): Promise<void> {
    if (this.inFlight) return
    if (!force && this.options.canFetch && !this.options.canFetch()) {
      // 窗口不可见：跳过这一拍，但保持定时器继续走
      this.schedule()
      return
    }

    this.inFlight = true
    this.abortController = new AbortController()

    try {
      const quotes = await fetchQuotes(this.codes, this.abortController.signal)
      this.latest = quotes
      this.options.emit({ quotes, at: Date.now() })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.options.emit({ quotes: [], at: Date.now(), error: message })
    } finally {
      this.inFlight = false
      this.abortController = null
      this.schedule()
    }
  }
}
