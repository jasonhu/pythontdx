/**
 * 面板级推送。
 *
 * 背景：`0x0547` 已实测为快照，免费主站不做服务端推送；因此「推送」的
 * 边界是「主进程持有订阅并主动把结果推给渲染层」，而不是让每个组件
 * 自己 setInterval 拉一次。所有定时器、请求合并和窗口可见性判断都在这里。
 *
 * 这样做的实际收益：
 *  - 组件卸载/切 tab 时统一取消，不会留下孤儿定时器；
 *  - 同一任务只保留一个订阅，多个窗口可共享同一份调度；
 *  - 休市/窗口隐藏时可以按策略降频，而不是每个面板各降各的。
 */
import type { PushTask, PushUpdate } from '@shared/types'

/** 最短 1 秒，避免误传 0 把主进程打满 */
export const MIN_PUSH_INTERVAL = 1000

export function clampPushInterval(intervalMs: number): number {
  return Math.max(MIN_PUSH_INTERVAL, Math.trunc(intervalMs) || MIN_PUSH_INTERVAL)
}

interface Subscription {
  id: number
  task: PushTask
  intervalMs: number
  timer: NodeJS.Timeout | null
  inFlight: boolean
  stopped: boolean
  /** 因窗口不可见被跳过的次数；首次只等 100ms，避免被启动期 isVisible() 拖住 */
  skipped: number
}

/** 只负责调度；具体拉取由调用方注入，便于单测不碰网络/Electron。 */
export type PushFetcher = (task: PushTask) => Promise<unknown>

export class PushHub {
  private nextId = 1
  private subscriptions = new Map<number, Subscription>()

  constructor(
    private readonly emit: (update: PushUpdate) => void,
    private readonly fetchTask: PushFetcher,
    private readonly canFetch: () => boolean = () => true
  ) {}

  subscribe(task: PushTask, intervalMs: number): number {
    const id = this.nextId++
    const subscription: Subscription = {
      id,
      task,
      intervalMs: clampPushInterval(intervalMs),
      timer: null,
      inFlight: false,
      stopped: false,
      skipped: 0
    }
    this.subscriptions.set(id, subscription)
    // 首帧立即推，面板不用再各自 load 一次
    void this.tick(subscription)
    return id
  }

  unsubscribe(id: number): void {
    const subscription = this.subscriptions.get(id)
    if (!subscription) return
    subscription.stopped = true
    if (subscription.timer) clearTimeout(subscription.timer)
    this.subscriptions.delete(id)
  }

  stop(): void {
    for (const subscription of this.subscriptions.values()) {
      subscription.stopped = true
      if (subscription.timer) clearTimeout(subscription.timer)
    }
    this.subscriptions.clear()
  }

  /** 当前订阅数，仅用于调试/健康检查 */
  get size(): number {
    return this.subscriptions.size
  }

  private schedule(subscription: Subscription, delay?: number): void {
    if (subscription.stopped) return
    if (subscription.timer) clearTimeout(subscription.timer)
    subscription.timer = setTimeout(() => {
      subscription.timer = null
      void this.tick(subscription)
    }, delay ?? subscription.intervalMs)
  }

  private async tick(subscription: Subscription): Promise<void> {
    if (subscription.stopped || subscription.inFlight) return
    if (!this.canFetch()) {
      // 窗口刚创建时 isVisible() 可能还是 false。第一次只等 100ms 复查，
      // 否则按 10 秒重试会让首屏逐笔硬等 10 秒（实测）；之后按正常节拍，
      // 隐藏窗口里只是检查可见性，不会真的拉行情。
      this.schedule(
        subscription,
        subscription.skipped === 0 ? 100 : subscription.intervalMs
      )
      subscription.skipped += 1
      return
    }
    subscription.inFlight = true
    try {
      const data = await this.fetchTask(subscription.task)
      if (subscription.stopped) return
      this.emit({
        id: subscription.id,
        at: Date.now(),
        task: subscription.task,
        data
      })
    } catch (error) {
      if (subscription.stopped) return
      this.emit({
        id: subscription.id,
        at: Date.now(),
        task: subscription.task,
        error: error instanceof Error ? error.message : String(error)
      })
    } finally {
      subscription.inFlight = false
      this.schedule(subscription)
    }
  }
}
