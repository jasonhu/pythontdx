/**
 * 腾讯行情接口的原始报文 → 结构化数据。
 *
 * 所有解析函数都是「纯函数」：输入字符串/JSON，输出 shared/types 里定义的对象。
 * 这样做的好处是将来写单元测试不需要 mock 网络。
 *
 * 接口实测结论（2026-09 校验）：
 *   qt.gtimg.cn          A股 88 个字段（以 ~ 分隔）；港股 78 个字段，且部分下标含义不同
 *   web.ifzq.gtimg.cn    标准 JSON（UTF-8）
 *   smartbox.gtimg.cn    GBK 文本，形如 v_hint="sh~600519~贵州茅台~gzmt~GP-A^..."
 */
import type {
  KLineBar,
  KLinePeriod,
  KLineSeries,
  Market,
  MinutePoint,
  MinuteTrend,
  MultiDayTrend,
  OrderLevel,
  Quote,
  SearchItem
} from '@shared/types'
import { splitCode } from '@shared/market'

/* ------------------------------------------------------------ 小工具 */

/**
 * 规范化股票名称。
 *
 * 腾讯返回的名字会用空格做**视觉对齐填充**，实测样例：
 *   "五 粮 液"（五粮液）、"万  科Ａ"（万科Ａ）、"南  玻Ａ"（南玻Ａ）
 * 这些空格必须去掉，否则自选股列表里会出现「五 粮 液」这种怪名字。
 *
 * 但港股里存在纯英文名，例如 hk00033 = "INTL GENIUS"，
 * 那里的空格是有意义的，一并抹掉就变成 "INTLGENIUS" 了。
 *
 * 所以按「是否含 ASCII 字母」分流：
 *   · 纯中文名 → 空格一定是填充，全部去掉；
 *   · 含英文字母 → 只把连续空白压成一个空格。
 *
 * 注意全角字母（如 Ａ U+FF21）不算 ASCII 字母，
 * 所以「万  科Ａ」会走第一条分支，得到 "万科Ａ"，这是期望的结果。
 */
export function normalizeStockName(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  if (!/[A-Za-z]/.test(trimmed)) return trimmed.replace(/\s+/g, '')
  return trimmed.replace(/\s+/g, ' ')
}

/** 读取第 i 个字段并转成数字；空串/非法值返回 undefined */
function num(fields: string[], i: number): number | undefined {
  const raw = fields[i]
  if (raw === undefined) return undefined
  const trimmed = raw.trim()
  if (trimmed === '' || trimmed === '-') return undefined
  const value = Number(trimmed)
  return Number.isFinite(value) ? value : undefined
}

/** 同 num，但保证返回 number（缺失时为 fallback） */
function numOr(fields: string[], i: number, fallback = 0): number {
  return num(fields, i) ?? fallback
}

/** 从 start 开始读 5 组「价 / 量」 */
function readLevels(fields: string[], start: number): OrderLevel[] {
  const levels: OrderLevel[] = []
  for (let i = 0; i < 5; i++) {
    const price = num(fields, start + i * 2)
    const volume = num(fields, start + i * 2 + 1)
    if (price === undefined || price <= 0) continue
    levels.push({ price, volume: volume ?? 0 })
  }
  return levels
}

/**
 * 交易所时间字符串 → epoch ms。
 * A 股是 '20260921161437'，港股是 '2026/09/21 16:08:36'，两者都按东八区解释。
 */
function parseExchangeTime(raw: string | undefined): number {
  if (!raw) return Date.now()
  const text = raw.trim()

  const compact = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(text)
  if (compact) {
    return shanghaiEpoch(
      Number(compact[1]),
      Number(compact[2]),
      Number(compact[3]),
      Number(compact[4]),
      Number(compact[5]),
      Number(compact[6])
    )
  }

  const slashed = /^(\d{4})\/(\d{2})\/(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(text)
  if (slashed) {
    return shanghaiEpoch(
      Number(slashed[1]),
      Number(slashed[2]),
      Number(slashed[3]),
      Number(slashed[4]),
      Number(slashed[5]),
      Number(slashed[6])
    )
  }

  const fallback = new Date(text).getTime()
  return Number.isNaN(fallback) ? Date.now() : fallback
}

/** 把「东八区的墙上时间」换算成 epoch ms（与运行机器的时区无关） */
function shanghaiEpoch(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number
): number {
  return Date.UTC(year, month - 1, day, hour - 8, minute, second)
}

/* -------------------------------------------------------- 实时行情解析 */

/** 接口无匹配代码时腾讯会返回这个「伪变量」 */
const NONE_MATCH = 'pv_none_match'

/**
 * 解析 qt.gtimg.cn 的响应体。
 * 输入形如：v_sh600519="1~贵州茅台~600519~1252.57~...";\nv_sz000001="...";
 */
export function parseQuotePayload(payload: string): Quote[] {
  const quotes: Quote[] = []
  const pattern = /v_([a-z]{2}\d{4,6})="([^"]*)"/gi

  let match: RegExpExecArray | null
  while ((match = pattern.exec(payload)) !== null) {
    const code = match[1].toLowerCase()
    const fields = match[2].split('~')
    if (fields.length < 10) continue // 无效行
    quotes.push(parseQuoteFields(code, fields))
  }

  return quotes
}

/** 单只股票字段解析：按市场分派到不同的下标映射 */
export function parseQuoteFields(code: string, fields: string[]): Quote {
  const { market, symbol } = splitCode(code)
  const receivedAt = Date.now()

  const name = normalizeStockName(fields[1] ?? '') || symbol
  const prevClose = numOr(fields, 4)
  let price = numOr(fields, 3)
  // 停牌 / 集合竞价前，最新价可能为 0，此时用昨收兜底避免出现 -100% 的离谱涨跌幅
  if (price <= 0) price = prevClose

  const change = num(fields, 31) ?? (prevClose > 0 ? price - prevClose : 0)
  const changePct = num(fields, 32) ?? (prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : 0)

  const base = {
    code,
    symbol,
    name,
    market,
    price,
    prevClose,
    open: numOr(fields, 5),
    high: numOr(fields, 33),
    low: numOr(fields, 34),
    change,
    changePct,
    time: parseExchangeTime(fields[30]),
    receivedAt,
    bids: readLevels(fields, 9),
    asks: readLevels(fields, 19)
  }

  return market === 'HK' ? buildHkQuote(base, fields) : buildAShareQuote(base, fields)
}

type QuoteBase = Omit<Quote, 'volume' | 'amount' | 'currency'>

function buildAShareQuote(base: QuoteBase, fields: string[]): Quote {
  return {
    ...base,
    // A 股成交量单位是「手」，成交额单位是「万元」
    volume: numOr(fields, 6),
    amount: numOr(fields, 37) * 1e4,
    turnoverRate: num(fields, 38),
    peTtm: num(fields, 39),
    amplitude: num(fields, 43),
    floatCap: num(fields, 44),
    totalCap: num(fields, 45),
    pb: num(fields, 46),
    limitUp: num(fields, 47),
    limitDown: num(fields, 48),
    volumeRatio: num(fields, 49),
    avgPrice: num(fields, 51),
    peDynamic: num(fields, 52),
    peStatic: num(fields, 53),
    currency: (fields[82] ?? 'CNY').trim() || 'CNY'
  }
}

/**
 * 港股字段布局与 A 股不同（78 个字段）：
 *   6/37 的成交量与成交额分别以「股 / 元」为单位；
 *   38 不是换手率，46 是英文名而不是市净率，47/48 是 52 周高低而非涨跌停。
 */
function buildHkQuote(base: QuoteBase, fields: string[]): Quote {
  return {
    ...base,
    volume: numOr(fields, 6),
    amount: numOr(fields, 37),
    turnoverRate: undefined,
    peTtm: num(fields, 39),
    amplitude: num(fields, 43),
    floatCap: num(fields, 44),
    totalCap: num(fields, 45),
    pb: undefined,
    limitUp: undefined,
    limitDown: undefined,
    volumeRatio: undefined,
    avgPrice: undefined,
    peDynamic: undefined,
    peStatic: undefined,
    currency: 'HKD'
  }
}

/* ---------------------------------------------------------- 分时解析 */

interface RawMinuteBody {
  data?: Record<
    string,
    {
      data?: { data?: string[]; date?: string }
      /**
       * 冗余的实时快照，用来取昨收与名称。
       * 注意：它在 `data.<代码>.qt` 这一层，**不在响应顶层**。
       * 这里踩过坑——按顶层取会得到 undefined，导致昨收变成 0、
       * 涨跌幅算出 Infinity、界面显示成「—%」。
       */
      qt?: Record<string, string[]>
    }
  >
}

export interface MinuteParseOptions {
  /** 每股 = 多少「手」的换算系数：A 股为 100，港股为 1 */
  sharesPerLot?: number
}

/**
 * 解析当日分时。
 * 原始行格式：'HHMM 价格 累计成交量 累计成交额'
 */
export function parseMinute(
  code: string,
  raw: RawMinuteBody,
  options: MinuteParseOptions = {}
): MinuteTrend {
  const body = raw.data?.[code]
  const snapshot = body?.qt?.[code] ?? []

  return {
    code,
    name: (snapshot[1] ?? '').trim(),
    date: body?.data?.date ?? '',
    prevClose: Number(snapshot[4]) || 0,
    points: buildMinutePoints(body?.data?.data ?? [], options)
  }
}

/**
 * 把原始分时行转成绘图用的点。
 *
 * 原始行：'HHMM 价格 累计成交量 累计成交额'
 *   · 成交量与成交额都是**当日累计值**，这里换算成每分钟增量；
 *   · 均价 = 累计成交额 ÷ 累计成交股数（A 股成交量单位是「手」，要 ×100）。
 */
function buildMinutePoints(rows: string[], options: MinuteParseOptions): MinutePoint[] {
  const { sharesPerLot = 100 } = options
  const points: MinutePoint[] = []
  let lastCumulativeVolume = 0

  for (const row of rows) {
    const [time, priceText, volumeText, amountText] = row.trim().split(/\s+/)
    if (!time || !priceText) continue
    if (!isAShareMinute(time)) continue

    const price = Number(priceText)
    const cumulativeVolume = Number(volumeText)
    const cumulativeAmount = Number(amountText)
    if (!Number.isFinite(price) || price <= 0) continue

    const volume = Number.isFinite(cumulativeVolume)
      ? Math.max(0, cumulativeVolume - lastCumulativeVolume)
      : 0
    if (Number.isFinite(cumulativeVolume)) lastCumulativeVolume = cumulativeVolume

    const tradedShares = cumulativeVolume * sharesPerLot
    const avg =
      Number.isFinite(cumulativeAmount) && tradedShares > 0
        ? cumulativeAmount / tradedShares
        : price

    points.push({ time, price, avg, volume })
  }

  return points
}

/* ------------------------------------------------------- 五日分时解析 */

interface RawDayQueryBody {
  data?: Record<
    string,
    {
      /** 注意这里是**数组**（不是按日期作键的对象），[0] 是最新的一天 */
      data?: { date?: string; data?: string[] }[]
      qt?: Record<string, string[]>
    }
  >
}

/**
 * 解析五日分时（day/query）。
 *
 * 每天各自的「昨收」接口没有直接给，需要按下面的方式推导：
 *   · 最新一天的昨收 = 快照 qt[4]（权威值）；
 *   · 更早的那些天，其昨收 = 比它再早一天的最后成交价。
 *     （响应里日期是倒序的，所以 day[i] 的前一交易日就是 day[i+1]）
 *   · 最早的那一天没有更早的数据可用，退化成用它自己的首个分时价当基准，
 *     这只会影响那一天线段的上色，不影响价格本身。
 */
export function parseMultiDayTrend(
  code: string,
  raw: RawDayQueryBody,
  options: MinuteParseOptions = {}
): MultiDayTrend {
  const body = raw.data?.[code]
  const entries = Array.isArray(body?.data) ? body.data : []
  const snapshot = body?.qt?.[code] ?? []
  const name = (snapshot[1] ?? '').trim()

  const parsed = entries.map((entry) => ({
    date: entry?.date ?? '',
    points: buildMinutePoints(entry?.data ?? [], options)
  }))

  const days: MinuteTrend[] = parsed.map((day, index) => {
    const olderDay = parsed[index + 1]
    const olderClose = olderDay?.points[olderDay.points.length - 1]?.price
    const prevClose =
      index === 0
        ? Number(snapshot[4]) || olderClose || day.points[0]?.price || 0
        : (olderClose ?? day.points[0]?.price ?? 0)

    return { code, name, date: day.date, prevClose, points: day.points }
  })

  // 统一成「从旧到新」，绘图时左旧右新
  return { code, name, days: days.reverse() }
}

/**
 * A 股分时只应该有 09:30–11:30 与 13:01–15:00 两段。
 * 收盘后接口会继续补点（15:01…15:30 一直重复收盘价），画在图上是多余的。
 */
function isAShareMinute(time: string): boolean {
  if (time.length !== 4) return true
  return (time >= '0930' && time <= '1130') || (time >= '1301' && time <= '1500')
}

/* ---------------------------------------------------------- K 线解析 */

interface RawKlineBody {
  data?: Record<string, Record<string, unknown>>
  code?: number
  msg?: string
}

/**
 * 解析 K 线。
 * 请求前复权（qfq）时腾讯返回的键是 qfqday / qfqweek / qfqmonth；
 * 不复权时是 day / week / month。这里两种都兼容。
 */
export function parseKline(code: string, period: KLinePeriod, raw: RawKlineBody): KLineSeries {
  const body = raw.data?.[code] ?? {}
  const rows = (body[`qfq${period}`] ?? body[period] ?? []) as unknown

  const bars: KLineBar[] = []
  if (Array.isArray(rows)) {
    for (const row of rows) {
      if (!Array.isArray(row) || row.length < 6) continue
      const [date, open, close, high, low, volume] = row as string[]
      const bar: KLineBar = {
        date: String(date),
        open: Number(open),
        close: Number(close),
        high: Number(high),
        low: Number(low),
        volume: Number(volume)
      }
      if (!Number.isFinite(bar.close) || bar.close <= 0) continue
      bars.push(bar)
    }
  }

  return { code, period, bars }
}

/* ---------------------------------------------------------- 搜索解析 */

/**
 * 解析 smartbox 联想搜索。
 * 原始：v_hint="sh~600519~贵州茅台~gzmt~GP-A^sz~000858~五粮液~wly~GP-A";
 * 无结果：v_hint="N";
 */
export function parseSearch(payload: string): SearchItem[] {
  const match = /v_hint="([^"]*)"/.exec(payload)
  if (!match || !match[1] || match[1] === 'N') return []

  const items: SearchItem[] = []
  for (const entry of match[1].split('^')) {
    const parts = entry.split('~')
    if (parts.length < 3) continue

    const prefix = parts[0].trim().toLowerCase()
    const symbol = parts[1].trim()
    const name = parts[2].trim()
    if (!prefix || !symbol) continue

    const market = (
      ['sh', 'sz', 'bj', 'hk', 'us'].includes(prefix) ? prefix.toUpperCase() : 'UNKNOWN'
    ) as Market

    items.push({
      code: `${prefix}${symbol}`,
      symbol,
      name,
      market,
      kind: (parts[4] ?? '').trim()
    })
  }

  return items
}

/** 判断响应是否表示「没有匹配的代码」 */
export function isNoneMatch(payload: string): boolean {
  return payload.includes(NONE_MATCH)
}
