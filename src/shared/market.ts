/**
 * 市场相关的纯函数：代码归一化、市场推断、交易时段判断。
 * 不依赖任何运行时 API，主进程与渲染进程共用。
 */
import type { Market } from './types'

/** 各市场代码前缀 → 市场 */
const PREFIX_TO_MARKET: Record<string, Market> = {
  sh: 'SH',
  sz: 'SZ',
  bj: 'BJ',
  hk: 'HK',
  us: 'US'
}

export const MARKET_TO_PREFIX: Record<Market, string> = {
  SH: 'sh',
  SZ: 'sz',
  BJ: 'bj',
  HK: 'hk',
  US: 'us',
  UNKNOWN: ''
}

/** 把 'sh600519' 拆成 { market: 'SH', symbol: '600519' } */
export function splitCode(code: string): { market: Market; symbol: string } {
  const trimmed = code.trim().toLowerCase()
  const prefix = trimmed.slice(0, 2)
  const market = PREFIX_TO_MARKET[prefix]
  if (market) {
    return { market, symbol: trimmed.slice(2) }
  }
  return { market: 'UNKNOWN', symbol: trimmed }
}

/** 拼回标准代码 */
export function joinCode(market: Market, symbol: string): string {
  return `${MARKET_TO_PREFIX[market]}${symbol}`
}

/**
 * 根据纯数字代码推断市场。
 *
 * 有一个绕不开的歧义：`000xxx` 既可能是深市主板股票（000001 平安银行、
 * 000858 五粮液），也可能是上证系列指数（000001 上证指数、000300 沪深300）。
 * 因为绝大多数 000xxx 都是股票，这里**一律按深市股票解释**；
 * 要查指数请显式带上前缀，例如 `sh000001`。
 *
 * （这个规则是被单元测试逼出来的：最初写了「000 开头且非 000001 就当沪市」，
 *   结果把五粮液 000858 判成了沪市。）
 */
export function inferMarket(symbol: string): Market {
  const s = symbol.trim()
  if (!/^\d+$/.test(s)) return 'US'
  if (s.length === 5) return 'HK'
  if (s.length === 6) {
    // 北交所：43 / 83 / 87 / 88 / 92 开头
    if (/^(43|83|87|88|92)/.test(s)) return 'BJ'
    // 沪市：60 主板 / 68 科创板 / 90 B股 / 11 可转债 / 5x 基金
    if (/^(60|68|90|11|50|51|52|56|58)/.test(s)) return 'SH'
    // 其余归深市：00 主板 / 30 创业板 / 20 B股 / 15|16|18 基金 / 12 可转债 / 39 指数
    return 'SZ'
  }
  return 'UNKNOWN'
}

/** 用户输入 → 标准代码；无法识别时返回 null */
export function normalizeCode(input: string): string | null {
  const raw = input.trim().toLowerCase().replace(/\s+/g, '')
  if (!raw) return null

  // 已经带前缀
  if (/^(sh|sz|bj|hk|us)\d{4,6}$/.test(raw)) return raw

  // 纯数字
  if (/^\d{5,6}$/.test(raw)) {
    const market = inferMarket(raw)
    return market === 'UNKNOWN' ? null : joinCode(market, raw)
  }

  return null
}

/** 该市场是否适用 A 股的「红涨绿跌」配色（港股/美股习惯相反，本 App 统一按用户所在市场惯例） */
export function isRedUpMarket(market: Market): boolean {
  return market === 'SH' || market === 'SZ' || market === 'BJ' || market === 'HK'
}

/* ------------------------------------------------------------ 交易时段 */

const SHANGHAI_PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Shanghai',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false
})

export type MarketSession = 'pre-open' | 'trading' | 'lunch-break' | 'closed' | 'weekend'

export const SESSION_LABEL: Record<MarketSession, string> = {
  'pre-open': '集合竞价',
  trading: '交易中',
  'lunch-break': '午间休市',
  closed: '已收盘',
  weekend: '周末休市'
}

/** 粗略判断 A 股当前所处的时段（不含法定节假日，节假日会显示为「已收盘」） */
export function marketSession(now: Date = new Date()): MarketSession {
  const parts = SHANGHAI_PARTS.formatToParts(now)
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? ''
  const weekday = get('weekday')
  const hour = Number(get('hour')) % 24
  const minute = Number(get('minute'))
  const hm = hour * 60 + minute

  if (weekday === 'Sat' || weekday === 'Sun') return 'weekend'
  if (hm >= 9 * 60 + 15 && hm < 9 * 60 + 30) return 'pre-open'
  if (hm >= 9 * 60 + 30 && hm < 11 * 60 + 30) return 'trading'
  if (hm >= 11 * 60 + 30 && hm < 13 * 60) return 'lunch-break'
  if (hm >= 13 * 60 && hm <= 15 * 60) return 'trading'
  return 'closed'
}

export function isTradingNow(now: Date = new Date()): boolean {
  const session = marketSession(now)
  return session === 'trading' || session === 'pre-open'
}
