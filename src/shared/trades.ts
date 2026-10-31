import type { TradeTick } from './types'

/**
 * 把服务端更旧的一页拼到现有逐笔前面，按绝对序号去重。
 * 服务端分页从新到旧返回、页内时间正序；载入「全部」时每页都要保持时间正序。
 */
export function mergeTickPage(
  existing: readonly TradeTick[],
  page: readonly TradeTick[]
): { ticks: TradeTick[]; added: number } {
  const seen = new Set(existing.map((tick) => tick.index))
  const fresh: TradeTick[] = []
  for (const tick of page) {
    if (seen.has(tick.index)) continue
    seen.add(tick.index)
    fresh.push(tick)
  }
  return { ticks: [...fresh, ...existing], added: fresh.length }
}
