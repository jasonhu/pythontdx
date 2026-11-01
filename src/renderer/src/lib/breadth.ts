/**
 * 状态栏「涨跌家数」的启动调度。
 *
 * 为什么需要单独调度：`market_breadth` 要分页扫全市场 5000+ 只 A 股，
 * 在 macOS 冷启动实测独占 sidecar 串行队列 7.5 秒。它是辅助信息，
 * 不能排在首笔行情和分时图前面，否则窗口打开十几秒才有图形。
 *
 * 规则：只有连接已经 `live`（首帧行情已上屏）才启动；
 * 再等 `delayMs` 让图表/逐笔的首屏请求先走；之后按 `intervalMs` 轮询。
 */
export const BREADTH_DELAY_MS = 1200
export const BREADTH_INTERVAL_MS = 30_000

export interface BreadthScheduleOptions {
  delayMs?: number
  intervalMs?: number
}

/**
 * @returns 取消函数；未 live 时返回空函数，不创建任何定时器。
 */
export function scheduleBreadth(
  status: string,
  load: () => void,
  options: BreadthScheduleOptions = {}
): () => void {
  if (status !== 'live') return () => {}

  const delayMs = options.delayMs ?? BREADTH_DELAY_MS
  const intervalMs = options.intervalMs ?? BREADTH_INTERVAL_MS
  let interval: ReturnType<typeof setInterval> | undefined
  const timer = setTimeout(() => {
    load()
    interval = setInterval(load, intervalMs)
  }, delayMs)

  return () => {
    clearTimeout(timer)
    if (interval !== undefined) clearInterval(interval)
  }
}
