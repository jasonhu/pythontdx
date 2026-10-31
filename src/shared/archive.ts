/**
 * 收盘后自动归档的纯判定逻辑：只在工作日 15:05–15:40 之间触发一次。
 * 浏览器 / 桌面共用，时间由调用方注入，方便测试。
 */

export function localDateKey(now: Date): string {
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

export function shouldAutoArchive(
  now: Date,
  enabled: boolean,
  lastDate?: string,
  startMinutes = 15 * 60 + 5,
  endMinutes = 15 * 60 + 40
): boolean {
  if (!enabled) return false
  const weekday = now.getDay()
  if (weekday === 0 || weekday === 6) return false
  const minutes = now.getHours() * 60 + now.getMinutes()
  if (minutes < startMinutes || minutes > endMinutes) return false
  return lastDate !== localDateKey(now)
}
