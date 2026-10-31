/** 主图默认五条均线：5 / 10 / 20 / 60 / 120。 */

export const DEFAULT_MA_PERIODS = [5, 10, 20, 60, 120] as const

/**
 * 兼容旧设置（曾只存 3 条）：缺位补默认值，非法值回退；
 * 始终返回 5 个正整数周期。
 */
export function normalizeMaPeriods(value?: readonly number[]): number[] {
  const result: number[] = [...DEFAULT_MA_PERIODS]
  if (!value) return result
  for (let index = 0; index < result.length; index += 1) {
    const period = value[index]
    if (typeof period === 'number' && Number.isFinite(period) && period > 0) {
      result[index] = Math.min(250, Math.floor(period))
    }
  }
  return result
}
