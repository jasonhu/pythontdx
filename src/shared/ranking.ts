/**
 * 资金流排行的纯合并/排序逻辑。
 *
 * 排行是「先取全市场报价，再批量补 MAC 0x1218 资金流」两步；某只股票资金流
 * 请求失败（停牌、退市、MAC 主机超时）时只跳过该只，不把 0 当成净流入。
 * 这样界面上的名次和数字都能追溯到真实返回，而不是用成交额伪造。
 */
import type { CategoryQuote, MacMoneyFlowPoint } from './types'

export interface MoneyFlowRanking {
  quotes: CategoryQuote[]
  /** 成功拿到资金流的只数；可能小于输入报价数 */
  matched: number
  /** 输入报价只数（去重后） */
  total: number
}

/** 合并报价与资金流，按主力净流入降序；缺失资金流的报价被排除。 */
export function mergeMoneyFlowRanking(
  quotes: readonly CategoryQuote[],
  flows: readonly MacMoneyFlowPoint[]
): MoneyFlowRanking {
  const byCode = new Map(flows.map((flow) => [flow.code, flow]))
  const merged: CategoryQuote[] = []
  const seen = new Set<string>()
  for (const quote of quotes) {
    if (seen.has(quote.code)) continue
    seen.add(quote.code)
    const flow = byCode.get(quote.code)
    if (!flow) continue
    const amount = Number.isFinite(quote.amount) ? quote.amount : 0
    const mainNet = Number.isFinite(flow.mainNet) ? flow.mainNet : 0
    merged.push({
      ...quote,
      mainNet,
      mainRatio: amount > 0 ? (mainNet / amount) * 100 : 0,
      largeNet5d: Number.isFinite(flow.largeNet5d) ? flow.largeNet5d : 0
    })
  }
  merged.sort((left, right) => {
    const net = (right.mainNet ?? 0) - (left.mainNet ?? 0)
    if (net !== 0) return net
    return (right.amount ?? 0) - (left.amount ?? 0)
  })
  return {
    quotes: merged,
    matched: merged.length,
    total: seen.size
  }
}

/** 排行展示用：净流入（元）转成「亿/万」；负号保留在数字前。 */
export function formatNetFlow(value: number): string {
  if (!Number.isFinite(value)) return '—'
  const sign = value < 0 ? '-' : ''
  const absolute = Math.abs(value)
  if (absolute >= 100_000_000) return `${sign}${(absolute / 100_000_000).toFixed(2)} 亿`
  if (absolute >= 10_000) return `${sign}${(absolute / 10_000).toFixed(2)} 万`
  return `${sign}${absolute.toFixed(0)}`
}

/**
 * 振幅（%）=（最高 - 最低）/ 昨收 * 100。
 *
 * MAC 0x122B 直接给 high/low/prevClose，没有 amplitude 字段；全市场振幅榜
 * 必须自己算，否则排名会全是 0。
 */
export function amplitudePercent(quote: Pick<CategoryQuote, 'high' | 'low' | 'prevClose'>): number {
  if (!(quote.prevClose > 0)) return 0
  const range = Math.max(0, quote.high - quote.low)
  return (range / quote.prevClose) * 100
}

/**
 * 市值榜只保留有正市值的报价。
 *
 * MAC 0x122B 不含股本，必须补 0x0010；财务失败时字段缺失，不能把 0 当成
 * 「市值 0」参与排名，否则榜单全是假 0。
 */
export function filterCapQuotes(
  quotes: readonly CategoryQuote[],
  key: 'floatCap' | 'totalCap'
): { quotes: CategoryQuote[]; missing: number } {
  const result: CategoryQuote[] = []
  let missing = 0
  for (const quote of quotes) {
    const value = quote[key]
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) result.push(quote)
    else missing += 1
  }
  return { quotes: result, missing }
}
