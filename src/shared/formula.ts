/**
 * 公式回测与兼容入口。
 *
 * 表达式解析/求值在 `formula-engine.ts`；这里保留图表、选股、回测共用的
 * `evaluateFormula` 导出，以及不依赖 UI 的单标的/组合回测。
 * 回测只使用每根 K 线收盘后的信号，下一根才持仓，避免未来函数。
 */
import type { KLineBar } from './types'
import {
  evaluateFormula,
  evaluateFormulaDocument,
  FormulaError,
  type FormulaOutput,
  type FormulaResult
} from './formula-engine'

export { evaluateFormula, evaluateFormulaDocument, FormulaError }
export type { FormulaOutput, FormulaResult }

export interface FormulaBacktest {
  initial: number
  finalEquity: number
  strategyReturn: number
  holdReturn: number
  annualizedReturn: number
  trades: number
  winRate: number
  maxDrawdown: number
  equity: number[]
}

/**
 * 单标的公式回测。
 *
 * 用上一根 K 线的信号决定今天是否持仓，按今天开盘价进/出、收盘价计权益，
 * 避免“当天收盘信号当天成交”的未来函数。手续费按单边 0.03% 估算。
 */
export function backtestFormula(
  result: FormulaResult,
  bars: readonly KLineBar[],
  initial = 100_000,
  feeRate = 0.0003
): FormulaBacktest {
  if (bars.length < 2) throw new FormulaError('回测至少需要 2 根 K 线')
  if (result.values.length !== bars.length) throw new FormulaError('公式长度与 K 线不一致')
  let equity = initial
  let previousPosition = false
  let trades = 0
  let peak = initial
  let maxDrawdown = 0
  let entryEquity = 0
  let closedTrades = 0
  let winningTrades = 0
  const curve: number[] = [initial]
  const holdCurve: number[] = [initial]

  for (let index = 1; index < bars.length; index += 1) {
    // 用上一根收盘后的信号决定今天是否持仓，避免未来函数。
    const position = Number.isFinite(result.values[index - 1]) && result.values[index - 1] > 0
    if (position !== previousPosition) {
      equity *= 1 - feeRate
      trades += 1
      if (position) {
        entryEquity = equity
      } else if (entryEquity > 0) {
        closedTrades += 1
        if (equity > entryEquity) winningTrades += 1
      }
      previousPosition = position
    }
    if (position && bars[index - 1].close > 0) {
      // 持仓吃的是收盘到收盘的收益，包含隔夜；不假设当天开盘能成交。
      equity *= bars[index].close / bars[index - 1].close
    }
    curve.push(equity)
    holdCurve.push(initial * (bars[index].close / bars[0].close))
    peak = Math.max(peak, equity)
    maxDrawdown = Math.max(maxDrawdown, peak > 0 ? (peak - equity) / peak : 0)
  }

  const finalEquity = curve[curve.length - 1]
  const holdFinal = holdCurve[holdCurve.length - 1]
  const years = (bars.length - 1) / 252
  const ratio = finalEquity / initial
  const annualizedReturn = ratio > 0 && years > 0 ? (Math.pow(ratio, 1 / years) - 1) * 100 : 0
  return {
    initial,
    finalEquity,
    strategyReturn: (finalEquity / initial - 1) * 100,
    holdReturn: (holdFinal / initial - 1) * 100,
    annualizedReturn,
    trades,
    winRate: closedTrades > 0 ? (winningTrades / closedTrades) * 100 : 0,
    maxDrawdown: maxDrawdown * 100,
    equity: curve
  }
}

export interface FormulaPortfolioBacktest {
  initial: number
  finalEquity: number
  strategyReturn: number
  holdReturn: number
  maxDrawdown: number
  days: number
  stocks: number
  trades: number
  curve: number[]
}

/**
 * 自选池等权组合回测（近似）。
 *
 * 每只股票按自己的交易日期计算“上一根信号 -> 当天收盘”的收益；
 * 同一天有数据的股票等权平均，缺数据视为现金。手续费按每只股票每次调仓
 * 从当天收益里扣，避免把组合手续费算成单只。
 */
export function backtestPortfolio(
  items: ReadonlyArray<{ bars: readonly KLineBar[]; result: FormulaResult }>,
  initial = 100_000,
  feeRate = 0.0003
): FormulaPortfolioBacktest {
  const daily = new Map<string, number[]>()
  let trades = 0
  let holdSum = 0
  let holdCount = 0
  let stocks = 0

  for (const item of items) {
    const { bars, result } = item
    if (bars.length < 2 || result.values.length !== bars.length) continue
    stocks += 1
    if (bars[0].close > 0 && bars[bars.length - 1].close > 0) {
      holdSum += bars[bars.length - 1].close / bars[0].close
      holdCount += 1
    }
    let previousPosition = false
    for (let index = 1; index < bars.length; index += 1) {
      if (bars[index - 1].close <= 0) continue
      const position = Number.isFinite(result.values[index - 1]) && result.values[index - 1] > 0
      let dayReturn = position ? bars[index].close / bars[index - 1].close - 1 : 0
      if (position !== previousPosition) {
        dayReturn -= feeRate
        trades += 1
        previousPosition = position
      }
      const bucket = daily.get(bars[index].date)
      if (bucket) bucket.push(dayReturn)
      else daily.set(bars[index].date, [dayReturn])
    }
  }

  if (stocks === 0) throw new FormulaError('组合回测没有可用标的')
  let equity = initial
  let peak = initial
  let maxDrawdown = 0
  const curve: number[] = [initial]
  const dates = [...daily.keys()].sort()
  for (const date of dates) {
    const returns = daily.get(date) ?? []
    if (returns.length === 0) continue
    const average = returns.reduce((sum, value) => sum + value, 0) / returns.length
    equity *= 1 + average
    curve.push(equity)
    peak = Math.max(peak, equity)
    maxDrawdown = Math.max(maxDrawdown, peak > 0 ? (peak - equity) / peak : 0)
  }
  return {
    initial,
    finalEquity: equity,
    strategyReturn: (equity / initial - 1) * 100,
    holdReturn: holdCount > 0 ? (holdSum / holdCount - 1) * 100 : 0,
    maxDrawdown: maxDrawdown * 100,
    days: dates.length,
    stocks,
    trades,
    curve
  }
}
