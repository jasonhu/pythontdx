/**
 * 展示层格式化工具（纯函数，主进程与渲染进程均可使用）。
 * 数字统一使用「中文金融习惯」：万 / 亿 分级，保留 2 位小数。
 */

const NBSP = '\u2007' // figure space：让数字对齐时不跳动

export function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

/** 安全数字：NaN/Infinity/undefined → null，避免界面上出现 NaN */
export function safeNum(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : (v as number)
  return isFiniteNumber(n) ? n : null
}

/** 固定小数位，缺省显示占位符 */
export function fixed(v: number | null | undefined, digits = 2): string {
  return isFiniteNumber(v) ? v.toFixed(digits) : '—'
}

/** 带正负号的涨跌额 */
export function signed(v: number | null | undefined, digits = 2): string {
  if (!isFiniteNumber(v)) return '—'
  const s = v.toFixed(digits)
  return v > 0 ? `+${s}` : s
}

/** 带正负号的百分比 */
export function signedPct(v: number | null | undefined, digits = 2): string {
  return `${signed(v, digits)}%`
}

/** 千分位整数 */
export function thousands(v: number | null | undefined): string {
  if (!isFiniteNumber(v)) return '—'
  return v.toLocaleString('zh-CN', { maximumFractionDigits: 0 })
}

/**
 * 金额压缩：自动选择 万 / 亿 单位。
 * @param v 单位「元」
 */
export function compactAmount(v: number | null | undefined, digits = 2): string {
  if (!isFiniteNumber(v)) return '—'
  const abs = Math.abs(v)
  if (abs >= 1e12) return `${(v / 1e12).toFixed(digits)}万亿`
  if (abs >= 1e8) return `${(v / 1e8).toFixed(digits)}亿`
  if (abs >= 1e4) return `${(v / 1e4).toFixed(digits)}万`
  return v.toFixed(0)
}

/**
 * 成交量压缩：输入单位「手」，输出带单位的中文文本。
 */
export function compactVolume(hands: number | null | undefined, digits = 2): string {
  if (!isFiniteNumber(hands)) return '—'
  const abs = Math.abs(hands)
  if (abs >= 1e8) return `${(hands / 1e8).toFixed(digits)}亿手`
  if (abs >= 1e4) return `${(hands / 1e4).toFixed(digits)}万手`
  return `${hands.toFixed(0)}手`
}

/** 市值：输入单位「亿元」 */
export function compactCap(yi: number | null | undefined, digits = 2): string {
  if (!isFiniteNumber(yi)) return '—'
  if (Math.abs(yi) >= 1e4) return `${(yi / 1e4).toFixed(digits)}万亿`
  return `${yi.toFixed(digits)}亿`
}

/** 交易时间：'20260921161437' 或 '2026/09/21 16:08:36' → HH:MM:SS */
export function timeOfDay(v: number | null | undefined): string {
  if (!isFiniteNumber(v)) return '—'
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(new Date(v))
}

/** HHMM → HH:MM */
export function minuteLabel(hhmm: string): string {
  return hhmm.length === 4 ? `${hhmm.slice(0, 2)}:${hhmm.slice(2)}` : hhmm
}

/** 数据新鲜度描述 */
export function relativeFrom(ts: number, now = Date.now()): string {
  const diff = Math.max(0, now - ts)
  if (diff < 1000) return '刚刚'
  if (diff < 60_000) return `${Math.floor(diff / 1000)} 秒前`
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  return `${Math.floor(diff / 3_600_000)} 小时前`
}

export { NBSP }
