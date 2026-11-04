/**
 * 收盘后自动归档的纯判定逻辑：只在工作日 15:46–16:30 之间触发一次。
 *
 * 为什么不是 15:05：通达信要求在交易日 08:45–15:45 暂停离线下载（官方要集中资源
 * 发行情数据），Python 侧对所有批量归档命令做了窗口保护；15:05 触发会被拒绝，
 * 而且原来的 15:40 截止会让自动归档在 15:45 后永远不触发。
 * 浏览器 / 桌面共用，时间由调用方注入，方便测试。
 */

/** 统一按北京时间（UTC+8）取日期/时段；非 UTC+8 机器也不会错日。 */
function shanghaiParts(now: Date): {
  year: number
  month: number
  day: number
  weekday: number
  minutes: number
} {
  const shifted = new Date(now.getTime() + 8 * 60 * 60 * 1000)
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    weekday: shifted.getUTCDay(),
    minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes()
  }
}

export function localDateKey(now: Date): string {
  const parts = shanghaiParts(now)
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`
}

export function shouldAutoArchive(
  now: Date,
  enabled: boolean,
  lastDate?: string,
  startMinutes = 15 * 60 + 46,
  endMinutes = 16 * 60 + 30
): boolean {
  if (!enabled) return false
  const parts = shanghaiParts(now)
  if (parts.weekday === 0 || parts.weekday === 6) return false
  const minutes = parts.minutes
  if (minutes < startMinutes || minutes > endMinutes) return false
  return lastDate !== localDateKey(now)
}
