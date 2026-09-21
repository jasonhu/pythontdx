/**
 * 腾讯行情接口门面。
 *
 * 四个上游：
 *   qt.gtimg.cn           实时快照（GBK 文本，支持一次请求多只）
 *   web.ifzq.gtimg.cn     当日分时 / 五日分时 / K 线（UTF-8 JSON）
 *   smartbox.gtimg.cn     搜索联想（GBK 文本）
 */
import type {
  KLinePeriod,
  KLineSeries,
  MinuteTrend,
  MultiDayTrend,
  Quote,
  SearchItem
} from '@shared/types'
import { splitCode } from '@shared/market'
import { requestJson, requestTextWithRetry } from '../http'
import { TtlCache } from '../cache'
import {
  parseKline,
  parseMinute,
  parseMultiDayTrend,
  parseQuotePayload,
  parseSearch
} from './parse'

const REALTIME_ENDPOINT = 'https://qt.gtimg.cn/q='
const MINUTE_ENDPOINT = 'https://web.ifzq.gtimg.cn/appstock/app/minute/query'
const FIVE_DAY_ENDPOINT = 'https://web.ifzq.gtimg.cn/appstock/app/day/query'
const KLINE_ENDPOINT = 'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get'
const SEARCH_ENDPOINT = 'https://smartbox.gtimg.cn/s3/'

/** 腾讯接口对 Referer 有弱校验，带上更像正常网页访问 */
const REFERER = 'https://gu.qq.com/'

/** 单次实时请求的代码数量上限（URL 长度与接口限制的折中） */
const BATCH_SIZE = 60

const minuteCache = new TtlCache<MinuteTrend>(10_000)
const fiveDayCache = new TtlCache<MultiDayTrend>(60_000)
const klineCache = new TtlCache<KLineSeries>(60_000)
const searchCache = new TtlCache<SearchItem[]>(5 * 60_000)

function chunk<T>(items: T[], size: number): T[][] {
  const result: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size))
  }
  return result
}

/** 去重 + 转小写 + 丢掉空值，保证顺序稳定 */
function normalizeCodes(codes: string[]): string[] {
  return [...new Set(codes.map((code) => code.trim().toLowerCase()).filter(Boolean))]
}

/**
 * 批量拉取实时行情。
 * 返回顺序与入参一致；接口查不到的代码会被丢弃（由上层决定如何展示）。
 */
export async function fetchQuotes(codes: string[], signal?: AbortSignal): Promise<Quote[]> {
  const unique = normalizeCodes(codes)
  if (unique.length === 0) return []

  const batches = chunk(unique, BATCH_SIZE)
  const payloads = await Promise.all(
    batches.map((batch) =>
      requestTextWithRetry(`${REALTIME_ENDPOINT}${batch.join(',')}`, {
        encoding: 'gbk',
        referer: REFERER,
        signal
      })
    )
  )

  const byCode = new Map<string, Quote>()
  for (const quote of payloads.flatMap(parseQuotePayload)) {
    byCode.set(quote.code, quote)
  }

  return unique
    .map((code) => byCode.get(code))
    .filter((quote): quote is Quote => quote !== undefined)
}

/** 当日分时 */
export async function fetchMinuteTrend(code: string, signal?: AbortSignal): Promise<MinuteTrend> {
  return minuteCache.resolve(code, async () => {
    const { market } = splitCode(code)
    // 注意：不要加 &_var=xxx —— 带了它腾讯会返回 JSONP（var xxx={...}）而不是纯 JSON
    const url = `${MINUTE_ENDPOINT}?code=${encodeURIComponent(code)}`
    const raw = await requestJson<Parameters<typeof parseMinute>[1]>(url, {
      referer: REFERER,
      signal
    })
    return parseMinute(code, raw, { sharesPerLot: market === 'HK' ? 1 : 100 })
  })
}

/** 五日分时 */
export async function fetchFiveDayTrend(
  code: string,
  signal?: AbortSignal
): Promise<MultiDayTrend> {
  return fiveDayCache.resolve(code, async () => {
    const { market } = splitCode(code)
    const url = `${FIVE_DAY_ENDPOINT}?code=${encodeURIComponent(code)}`
    const raw = await requestJson<Parameters<typeof parseMultiDayTrend>[1]>(url, {
      referer: REFERER,
      signal
    })
    return parseMultiDayTrend(code, raw, { sharesPerLot: market === 'HK' ? 1 : 100 })
  })
}

/** K 线（前复权） */
export async function fetchKline(
  code: string,
  period: KLinePeriod,
  count = 200,
  signal?: AbortSignal
): Promise<KLineSeries> {
  const key = `${code}:${period}:${count}`
  return klineCache.resolve(key, async () => {
    // param 格式：代码,周期,起始日期,结束日期,数量,复权方式
    const param = `${code},${period},,,${count},qfq`
    const url = `${KLINE_ENDPOINT}?param=${param}`
    const raw = await requestJson<Parameters<typeof parseKline>[2]>(url, {
      referer: REFERER,
      signal
    })
    return parseKline(code, period, raw)
  })
}

/** 搜索联想 */
export async function fetchSearchHint(
  keyword: string,
  signal?: AbortSignal
): Promise<SearchItem[]> {
  const trimmed = keyword.trim()
  if (!trimmed) return []

  return searchCache.resolve(trimmed.toLowerCase(), async () => {
    const url = `${SEARCH_ENDPOINT}?v=2&q=${encodeURIComponent(trimmed)}&t=all`
    const payload = await requestTextWithRetry(url, { encoding: 'gbk', referer: REFERER, signal })
    return parseSearch(payload)
  })
}

/** 供「强制刷新」使用：清掉缓存再拉 */
export function invalidateTrendCache(): void {
  minuteCache.clear()
  klineCache.clear()
}
