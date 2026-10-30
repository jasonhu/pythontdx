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

const FUNCTIONS = new Set(['MA', 'EMA', 'REF', 'ABS', 'MAX', 'MIN', 'CROSS'])

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
  trades: number
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
  const curve: number[] = [initial]
  const holdCurve: number[] = [initial]

  for (let index = 1; index < bars.length; index += 1) {
    const position = Number.isFinite(result.values[index - 1]) && result.values[index - 1] > 0
    if (position !== previousPosition) {
      equity *= 1 - feeRate
      trades += 1
      previousPosition = position
    }
    if (position && bars[index].open > 0) {
      equity *= bars[index].close / bars[index].open
    }
    curve.push(equity)
    holdCurve.push(bars[0].open > 0 ? initial * (bars[index].close / bars[0].open) : initial)
    peak = Math.max(peak, equity)
    maxDrawdown = Math.max(maxDrawdown, peak > 0 ? (peak - equity) / peak : 0)
  }

  const finalEquity = curve[curve.length - 1]
  const holdFinal = holdCurve[holdCurve.length - 1]
  return {
    initial,
    finalEquity,
    strategyReturn: (finalEquity / initial - 1) * 100,
    holdReturn: (holdFinal / initial - 1) * 100,
    trades,
    maxDrawdown: maxDrawdown * 100,
    equity: curve
  }
}
