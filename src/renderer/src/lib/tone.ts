/** 涨跌语义色：全 App 统一的「红涨绿跌」判定 */
export type Tone = 'up' | 'down' | 'flat'

export function toneOf(value: number | null | undefined): Tone {
  if (value === null || value === undefined || !Number.isFinite(value) || value === 0) return 'flat'
  return value > 0 ? 'up' : 'down'
}

/** 涨跌对应的 CSS 变量名，交给图表直接用 */
export function toneColorVar(tone: Tone): string {
  return tone === 'up' ? 'var(--up)' : tone === 'down' ? 'var(--down)' : 'var(--flat)'
}
