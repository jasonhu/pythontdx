/** 涨跌语义色：全 App 统一的「红涨绿跌」判定 */
export type Tone = 'up' | 'down' | 'flat'

export function toneOf(value: number | null | undefined): Tone {
  if (value === null || value === undefined || !Number.isFinite(value) || value === 0) return 'flat'
  return value > 0 ? 'up' : 'down'
}

/** 语义主色，用于文字与标签底色 */
export function toneColorVar(tone: Tone): string {
  return tone === 'up' ? 'var(--up)' : tone === 'down' ? 'var(--down)' : 'var(--flat)'
}

/**
 * 图表折线用的颜色。
 * 比文字色略亮一档（`--up-line` / `--down-line`），
 * 因为细线在深色背景上需要更高的对比度才看得清。
 */
export function toneLineVar(tone: Tone): string {
  return tone === 'up' ? 'var(--up-line)' : tone === 'down' ? 'var(--down-line)' : 'var(--flat)'
}

/**
 * 迷你走势图的线色。
 *
 * **有昨收时必须用昨收做基准**：这条线紧挨着「今日涨跌幅」那个数字，
 * 如果改用「末点 vs 首点」，高开回落的股票就会出现
 * 「线是绿的、旁边的数字是红的」这种自相矛盾的画面
 * （本项目真的踩过：比亚迪 +1.09% 却画成绿线）。
 */
export function sparklineTone(values: number[], baseline?: number): Tone {
  if (values.length === 0) return 'flat'
  const last = values[values.length - 1]
  const reference = baseline ?? (values.length > 1 ? values[0] : last)
  return toneOf(last - reference)
}
