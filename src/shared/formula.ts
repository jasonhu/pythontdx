/**
 * 安全的技术指标表达式求值器（图表公式预览用）。
 *
 * 支持：数字、OPEN/HIGH/LOW/CLOSE/VOL、+ - * /、比较、MA/EMA/REF/ABS/MAX/MIN/CROSS。
 * 不是完整通达信公式语言，也不执行任意代码；未知函数/变量直接报错。
 */
import type { KLineBar } from './types'

export class FormulaError extends Error {}

type Token =
  | { kind: 'number'; value: number }
  | { kind: 'ident'; value: string }
  | { kind: 'op'; value: string }
  | { kind: 'eof' }

type Node =
  | { kind: 'number'; value: number }
  | { kind: 'series'; name: string }
  | { kind: 'unary'; op: string; arg: Node }
  | { kind: 'binary'; op: string; left: Node; right: Node }
  | { kind: 'call'; name: string; args: Node[] }

const SERIES: Record<string, keyof KLineBar> = {
  OPEN: 'open',
  HIGH: 'high',
  LOW: 'low',
  CLOSE: 'close',
  VOL: 'volume',
  VOLUME: 'volume'
}

const FUNCTIONS = new Set([
  'MA',
  'EMA',
  'REF',
  'ABS',
  'MAX',
  'MIN',
  'CROSS',
  'SUM',
  'HHV',
  'LLV',
  'STD',
  'IF',
  'SMA',
  'WMA',
  'COUNT',
  'EVERY',
  'EXIST',
  'BARSLAST',
  'HHVBARS',
  'LLVBARS',
  'SQRT',
  'POW',
  'ROUND',
  'INTPART',
  'AND',
  'OR',
  'NOT',
  'RSI',
  'BIAS',
  'ATR'
])

function tokenize(expression: string): Token[] {
  const tokens: Token[] = []
  let index = 0
  while (index < expression.length) {
    const char = expression[index]
    if (/\s/.test(char)) {
      index += 1
      continue
    }
    if (/[0-9.]/.test(char)) {
      let end = index
      while (end < expression.length && /[0-9.]/.test(expression[end])) end += 1
      const value = Number(expression.slice(index, end))
      if (!Number.isFinite(value))
        throw new FormulaError(`数字不合法：${expression.slice(index, end)}`)
      tokens.push({ kind: 'number', value })
      index = end
      continue
    }
    if (/[A-Za-z_]/.test(char)) {
      let end = index
      while (end < expression.length && /[A-Za-z0-9_]/.test(expression[end])) end += 1
      tokens.push({ kind: 'ident', value: expression.slice(index, end).toUpperCase() })
      index = end
      continue
    }
    const two = expression.slice(index, index + 2)
    if (['>=', '<=', '==', '<>'].includes(two)) {
      tokens.push({ kind: 'op', value: two === '<>' ? '!=' : two })
      index += 2
      continue
    }
    if ('+-*/(),<>'.includes(char)) {
      tokens.push({ kind: 'op', value: char })
      index += 1
      continue
    }
    throw new FormulaError(`无法识别字符：${char}`)
  }
  tokens.push({ kind: 'eof' })
  return tokens
}

class Parser {
  private index = 0

  constructor(private readonly tokens: Token[]) {}

  parse(): Node {
    const node = this.comparison()
    if (this.peek().kind !== 'eof') throw new FormulaError('表达式末尾有多余内容')
    return node
  }

  private peek(): Token {
    return this.tokens[this.index] ?? { kind: 'eof' }
  }

  private takeOp(value: string): boolean {
    const token = this.peek()
    if (token.kind === 'op' && token.value === value) {
      this.index += 1
      return true
    }
    return false
  }

  private comparison(): Node {
    let left = this.additive()
    while (true) {
      const token = this.peek()
      if (token.kind !== 'op' || !['>', '<', '>=', '<=', '==', '!='].includes(token.value)) break
      this.index += 1
      left = { kind: 'binary', op: token.value, left, right: this.additive() }
    }
    return left
  }

  private additive(): Node {
    let left = this.multiplicative()
    while (true) {
      if (this.takeOp('+')) left = { kind: 'binary', op: '+', left, right: this.multiplicative() }
      else if (this.takeOp('-'))
        left = { kind: 'binary', op: '-', left, right: this.multiplicative() }
      else return left
    }
  }

  private multiplicative(): Node {
    let left = this.unary()
    while (true) {
      if (this.takeOp('*')) left = { kind: 'binary', op: '*', left, right: this.unary() }
      else if (this.takeOp('/')) left = { kind: 'binary', op: '/', left, right: this.unary() }
      else return left
    }
  }

  private unary(): Node {
    if (this.takeOp('-')) return { kind: 'unary', op: '-', arg: this.unary() }
    if (this.takeOp('+')) return this.unary()
    return this.primary()
  }

  private primary(): Node {
    const token = this.peek()
    if (token.kind === 'number') {
      this.index += 1
      return { kind: 'number', value: token.value }
    }
    if (token.kind === 'op' && token.value === '(') {
      this.index += 1
      const node = this.comparison()
      if (!this.takeOp(')')) throw new FormulaError('缺少右括号')
      return node
    }
    if (token.kind === 'ident') {
      this.index += 1
      if (this.takeOp('(')) {
        if (!FUNCTIONS.has(token.value)) throw new FormulaError(`未知函数：${token.value}`)
        const args: Node[] = []
        if (!this.takeOp(')')) {
          args.push(this.comparison())
          while (this.takeOp(',')) args.push(this.comparison())
          if (!this.takeOp(')')) throw new FormulaError(`函数 ${token.value} 缺少右括号`)
        }
        return { kind: 'call', name: token.value, args }
      }
      if (!(token.value in SERIES)) throw new FormulaError(`未知变量：${token.value}`)
      return { kind: 'series', name: token.value }
    }
    throw new FormulaError('表达式不完整')
  }
}

function lastFinite(values: number[]): number {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    if (Number.isFinite(values[index])) return values[index]
  }
  return Number.NaN
}

function withCount(node: Node, bars: KLineBar[]): number {
  const values = evaluate(node, bars)
  const count = Math.floor(lastFinite(values))
  if (!Number.isFinite(count) || count < 1) throw new FormulaError('周期必须是正整数')
  return count
}

function evaluate(node: Node, bars: KLineBar[]): number[] {
  switch (node.kind) {
    case 'number':
      return bars.map(() => node.value)
    case 'series':
      return bars.map((bar) => Number(bar[SERIES[node.name]] ?? Number.NaN))
    case 'unary':
      return evaluate(node.arg, bars).map((value) => -value)
    case 'binary': {
      const left = evaluate(node.left, bars)
      const right = evaluate(node.right, bars)
      return left.map((value, index) => {
        const other = right[index]
        switch (node.op) {
          case '+':
            return value + other
          case '-':
            return value - other
          case '*':
            return value * other
          case '/':
            return other === 0 ? Number.NaN : value / other
          case '>':
            return value > other ? 1 : 0
          case '<':
            return value < other ? 1 : 0
          case '>=':
            return value >= other ? 1 : 0
          case '<=':
            return value <= other ? 1 : 0
          case '==':
            return value === other ? 1 : 0
          case '!=':
            return value !== other ? 1 : 0
          default:
            return Number.NaN
        }
      })
    }
    case 'call': {
      switch (node.name) {
        case 'MA': {
          if (node.args.length !== 2) throw new FormulaError('MA 需要 2 个参数')
          const values = evaluate(node.args[0], bars)
          const count = withCount(node.args[1], bars)
          return values.map((_, index) => {
            if (index + 1 < count) return Number.NaN
            let sum = 0
            for (let offset = 0; offset < count; offset += 1) {
              const value = values[index - offset]
              if (!Number.isFinite(value)) return Number.NaN
              sum += value
            }
            return sum / count
          })
        }
        case 'EMA': {
          if (node.args.length !== 2) throw new FormulaError('EMA 需要 2 个参数')
          const values = evaluate(node.args[0], bars)
          const count = withCount(node.args[1], bars)
          const alpha = 2 / (count + 1)
          let previous = Number.NaN
          return values.map((value) => {
            if (!Number.isFinite(previous)) {
              if (!Number.isFinite(value)) return Number.NaN
              previous = value
              return value
            }
            if (!Number.isFinite(value)) return Number.NaN
            previous = alpha * value + (1 - alpha) * previous
            return previous
          })
        }
        case 'REF': {
          if (node.args.length !== 2) throw new FormulaError('REF 需要 2 个参数')
          const values = evaluate(node.args[0], bars)
          const count = withCount(node.args[1], bars)
          return values.map((_, index) => (index - count >= 0 ? values[index - count] : Number.NaN))
        }
        case 'ABS': {
          if (node.args.length !== 1) throw new FormulaError('ABS 需要 1 个参数')
          return evaluate(node.args[0], bars).map((value) => Math.abs(value))
        }
        case 'MAX':
        case 'MIN': {
          if (node.args.length !== 2) throw new FormulaError(`${node.name} 需要 2 个参数`)
          const left = evaluate(node.args[0], bars)
          const right = evaluate(node.args[1], bars)
          return left.map((value, index) =>
            node.name === 'MAX' ? Math.max(value, right[index]) : Math.min(value, right[index])
          )
        }
        case 'CROSS': {
          if (node.args.length !== 2) throw new FormulaError('CROSS 需要 2 个参数')
          const left = evaluate(node.args[0], bars)
          const right = evaluate(node.args[1], bars)
          return left.map((value, index) => {
            if (index === 0) return 0
            return value > right[index] && left[index - 1] <= right[index - 1] ? 1 : 0
          })
        }
        case 'SUM':
        case 'HHV':
        case 'LLV':
        case 'STD': {
          if (node.args.length !== 2) throw new FormulaError(`${node.name} 需要 2 个参数`)
          const values = evaluate(node.args[0], bars)
          const count = withCount(node.args[1], bars)
          return values.map((_, index) => {
            if (index + 1 < count) return Number.NaN
            const window = values.slice(index - count + 1, index + 1)
            if (window.some((value) => !Number.isFinite(value))) return Number.NaN
            if (node.name === 'SUM') return window.reduce((sum, value) => sum + value, 0)
            if (node.name === 'HHV') return Math.max(...window)
            if (node.name === 'LLV') return Math.min(...window)
            const mean = window.reduce((sum, value) => sum + value, 0) / count
            return Math.sqrt(window.reduce((sum, value) => sum + (value - mean) ** 2, 0) / count)
          })
        }
        case 'IF': {
          if (node.args.length !== 3) throw new FormulaError('IF 需要 3 个参数')
          const condition = evaluate(node.args[0], bars)
          const whenTrue = evaluate(node.args[1], bars)
          const whenFalse = evaluate(node.args[2], bars)
          return condition.map((value, index) =>
            Number.isFinite(value) && value > 0 ? whenTrue[index] : whenFalse[index]
          )
        }
        case 'SMA': {
          if (node.args.length !== 3) throw new FormulaError('SMA 需要 3 个参数')
          const values = evaluate(node.args[0], bars)
          const count = withCount(node.args[1], bars)
          const weight = withCount(node.args[2], bars)
          if (weight > count) throw new FormulaError('SMA 的 M 不能大于 N')
          let previous = Number.NaN
          return values.map((value) => {
            if (!Number.isFinite(value)) return Number.NaN
            previous = Number.isFinite(previous)
              ? (weight * value + (count - weight) * previous) / count
              : value
            return previous
          })
        }
        case 'WMA': {
          if (node.args.length !== 2) throw new FormulaError('WMA 需要 2 个参数')
          const values = evaluate(node.args[0], bars)
          const count = withCount(node.args[1], bars)
          const divisor = (count * (count + 1)) / 2
          return values.map((_, index) => {
            if (index + 1 < count) return Number.NaN
            let total = 0
            for (let offset = 0; offset < count; offset += 1) {
              const value = values[index - offset]
              if (!Number.isFinite(value)) return Number.NaN
              total += value * (count - offset)
            }
            return total / divisor
          })
        }
        case 'COUNT':
        case 'EVERY':
        case 'EXIST': {
          if (node.args.length !== 2) throw new FormulaError(`${node.name} 需要 2 个参数`)
          const values = evaluate(node.args[0], bars)
          const count = withCount(node.args[1], bars)
          return values.map((_, index) => {
            if (index + 1 < count) return Number.NaN
            const window = values.slice(index - count + 1, index + 1)
            if (node.name === 'COUNT') return window.filter((value) => value > 0).length
            if (node.name === 'EVERY') return window.every((value) => value > 0) ? 1 : 0
            return window.some((value) => value > 0) ? 1 : 0
          })
        }
        case 'BARSLAST': {
          if (node.args.length !== 1) throw new FormulaError('BARSLAST 需要 1 个参数')
          const values = evaluate(node.args[0], bars)
          let last = -1
          return values.map((value, index) => {
            if (value > 0) last = index
            return last >= 0 ? index - last : Number.NaN
          })
        }
        case 'HHVBARS':
        case 'LLVBARS': {
          if (node.args.length !== 2) throw new FormulaError(`${node.name} 需要 2 个参数`)
          const values = evaluate(node.args[0], bars)
          const count = withCount(node.args[1], bars)
          return values.map((_, index) => {
            if (index + 1 < count) return Number.NaN
            const window = values.slice(index - count + 1, index + 1)
            let target = node.name === 'HHVBARS' ? -Infinity : Infinity
            for (const value of window) {
              target = node.name === 'HHVBARS' ? Math.max(target, value) : Math.min(target, value)
            }
            return count - 1 - window.lastIndexOf(target)
          })
        }
        case 'SQRT': {
          if (node.args.length !== 1) throw new FormulaError('SQRT 需要 1 个参数')
          return evaluate(node.args[0], bars).map((value) =>
            value < 0 ? Number.NaN : Math.sqrt(value)
          )
        }
        case 'POW': {
          if (node.args.length !== 2) throw new FormulaError('POW 需要 2 个参数')
          const left = evaluate(node.args[0], bars)
          const right = evaluate(node.args[1], bars)
          return left.map((value, index) => value ** right[index])
        }
        case 'ROUND':
        case 'INTPART': {
          if (node.args.length !== 1) throw new FormulaError(`${node.name} 需要 1 个参数`)
          return evaluate(node.args[0], bars).map((value) =>
            node.name === 'ROUND' ? Math.round(value) : Math.trunc(value)
          )
        }
        case 'AND':
        case 'OR': {
          if (node.args.length !== 2) throw new FormulaError(`${node.name} 需要 2 个参数`)
          const left = evaluate(node.args[0], bars)
          const right = evaluate(node.args[1], bars)
          return left.map((value, index) =>
            node.name === 'AND'
              ? value > 0 && right[index] > 0
                ? 1
                : 0
              : value > 0 || right[index] > 0
                ? 1
                : 0
          )
        }
        case 'NOT': {
          if (node.args.length !== 1) throw new FormulaError('NOT 需要 1 个参数')
          return evaluate(node.args[0], bars).map((value) => (value > 0 ? 0 : 1))
        }
        case 'RSI': {
          if (node.args.length !== 2) throw new FormulaError('RSI 需要 2 个参数')
          const values = evaluate(node.args[0], bars)
          const count = withCount(node.args[1], bars)
          return values.map((_, index) => {
            if (index < count) return Number.NaN
            let gain = 0
            let loss = 0
            for (let offset = 0; offset < count; offset += 1) {
              const current = values[index - offset]
              const previous = values[index - offset - 1]
              if (!Number.isFinite(current) || !Number.isFinite(previous)) return Number.NaN
              const change = current - previous
              if (change >= 0) gain += change
              else loss -= change
            }
            if (loss === 0) return 100
            return 100 - 100 / (1 + gain / loss)
          })
        }
        case 'BIAS': {
          if (node.args.length !== 2) throw new FormulaError('BIAS 需要 2 个参数')
          const values = evaluate(node.args[0], bars)
          const count = withCount(node.args[1], bars)
          return values.map((value, index) => {
            if (index + 1 < count) return Number.NaN
            const window = values.slice(index - count + 1, index + 1)
            if (window.some((item) => !Number.isFinite(item))) return Number.NaN
            const mean = window.reduce((sum, item) => sum + item, 0) / count
            return mean === 0 ? Number.NaN : ((value - mean) / mean) * 100
          })
        }
        case 'ATR': {
          if (node.args.length !== 1) throw new FormulaError('ATR 需要 1 个参数')
          const count = withCount(node.args[0], bars)
          return bars.map((_, index) => {
            if (index + 1 < count || index === 0) return Number.NaN
            let total = 0
            for (let offset = 0; offset < count; offset += 1) {
              const current = bars[index - offset]
              const previous = bars[index - offset - 1]
              if (!current || !previous) return Number.NaN
              total += Math.max(
                current.high - current.low,
                Math.abs(current.high - previous.close),
                Math.abs(current.low - previous.close)
              )
            }
            return total / count
          })
        }
        default:
          throw new FormulaError(`未知函数：${node.name}`)
      }
    }
  }
}

export interface FormulaResult {
  values: number[]
  latest: number | null
  min: number | null
  max: number | null
}

export function evaluateFormula(expression: string, bars: readonly KLineBar[]): FormulaResult {
  const text = expression.trim()
  if (!text) throw new FormulaError('公式不能为空')
  if (text.length > 200) throw new FormulaError('公式过长（最多 200 字符）')
  if (bars.length === 0) throw new FormulaError('没有 K 线数据')
  const node = new Parser(tokenize(text)).parse()
  const values = evaluate(node, bars as KLineBar[])
  const finite = values.filter((value) => Number.isFinite(value))
  const latest = Number.isFinite(values[values.length - 1]) ? values[values.length - 1] : null
  return {
    values,
    latest,
    min: finite.length > 0 ? Math.min(...finite) : null,
    max: finite.length > 0 ? Math.max(...finite) : null
  }
}

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
