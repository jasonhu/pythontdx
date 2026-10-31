/**
 * 通达信公式语言的安全子集求值器（不执行任意代码）。
 *
 * 目标不是把通达信的解释器照搬进来，而是覆盖「指标/选股公式」真正会用到的部分：
 *   · 变量赋值 `A:=...;`、输出 `B:...;`、多语句/多输出；
 *   · 花括号注释、`C/O/H/L/V` 等常用别名、颜色修饰（只影响画线颜色）；
 *   · MA/EMA/SMA/WMA/DMA、REF、HHV/LLV、COUNT/EVERY、FILTER/BACKSET、
 *     CROSS/LONGCROSS、RSI/BIAS/ATR 等常用函数；
 *   · DRAWTEXT/STICKLINE/DRAWICON 等绘图语句会被解析，数值部分返回条件序列。
 *
 * 任何未实现的变量/函数都抛 FormulaError，不静默返回 0；财务、DLL、扩展数据
 * 这类需要额外数据源或原生代码的函数不在本求值器范围内。
 */
import type { KLineBar } from './types'

export class FormulaError extends Error {}

type Token =
  | { kind: 'number'; value: number }
  | { kind: 'ident'; value: string }
  | { kind: 'string'; value: string }
  | { kind: 'op'; value: string }
  | { kind: 'eof' }

type Node =
  | { kind: 'number'; value: number }
  | { kind: 'string'; value: string }
  | { kind: 'series'; name: string }
  | { kind: 'variable'; name: string }
  | { kind: 'unary'; op: string; arg: Node }
  | { kind: 'binary'; op: string; left: Node; right: Node }
  | { kind: 'call'; name: string; args: Node[] }

interface Statement {
  target?: string
  display: boolean
  node: Node
  color?: string
}

const SERIES: Record<string, keyof KLineBar> = {
  OPEN: 'open',
  O: 'open',
  HIGH: 'high',
  H: 'high',
  LOW: 'low',
  L: 'low',
  CLOSE: 'close',
  C: 'close',
  VOL: 'volume',
  V: 'volume',
  VOLUME: 'volume'
}

const SERIES_NAMES = new Set(Object.keys(SERIES))

const ZERO_ARG_FUNCTIONS = new Set(['TR', 'ISLASTBAR', 'CURRBARSCOUNT', 'TOTALBARSCOUNT'])

const FUNCTIONS = new Set([
  'MA',
  'EMA',
  'EXPMA',
  'EXPMEMA',
  'SMA',
  'WMA',
  'DMA',
  'TMA',
  'MEMA',
  'XMA',
  'REF',
  'REFV',
  'REFX',
  'REFXV',
  'ABS',
  'MAX',
  'MIN',
  'CROSS',
  'LONGCROSS',
  'SUM',
  'HHV',
  'LLV',
  'STD',
  'STDP',
  'VAR',
  'VARP',
  'AVEDEV',
  'DEVSQ',
  'IF',
  'IFF',
  'COUNT',
  'EVERY',
  'EXIST',
  'BARSLAST',
  'BARSLASTCOUNT',
  'BARSSINCE',
  'BARSCOUNT',
  'HHVBARS',
  'LLVBARS',
  'SQRT',
  'POW',
  'ROUND',
  'INTPART',
  'CEILING',
  'FLOOR',
  'SIGN',
  'MOD',
  'LN',
  'LOG',
  'EXP',
  'SIN',
  'COS',
  'TAN',
  'ASIN',
  'ACOS',
  'ATAN',
  'AND',
  'OR',
  'NOT',
  'RANGE',
  'BETWEEN',
  'RSI',
  'BIAS',
  'ATR',
  'TR',
  'FILTER',
  'FILTERX',
  'BACKSET',
  'VALUEWHEN',
  'UPNDAY',
  'DOWNNDAY',
  'NDAY',
  'SUMBARS',
  'CONST',
  'REVERSE',
  'ISLASTBAR',
  'CURRBARSCOUNT',
  'TOTALBARSCOUNT',
  'DRAWTEXT',
  'DRAWTEXT_FIX',
  'DRAWNUMBER',
  'DRAWNUMBER_FIX',
  'DRAWICON',
  'STICKLINE',
  'DRAWLINE',
  'DRAWBAND',
  'DRAWKLINE',
  'POLYLINE',
  'FILLRGN',
  'DRAWGBK'
])

const DRAWINGS = new Set([
  'DRAWTEXT',
  'DRAWTEXT_FIX',
  'DRAWNUMBER',
  'DRAWNUMBER_FIX',
  'DRAWICON',
  'STICKLINE',
  'DRAWLINE',
  'DRAWBAND',
  'DRAWKLINE',
  'POLYLINE',
  'FILLRGN',
  'DRAWGBK'
])

const DRAWING_ARGS: Record<string, number> = {
  DRAWTEXT: 3,
  DRAWTEXT_FIX: 4,
  DRAWNUMBER: 3,
  DRAWNUMBER_FIX: 4,
  DRAWICON: 3,
  STICKLINE: 5,
  DRAWLINE: 5,
  DRAWBAND: 4,
  DRAWKLINE: 4,
  POLYLINE: 1,
  FILLRGN: 3,
  DRAWGBK: 1
}

function tokenize(expression: string): Token[] {
  const tokens: Token[] = []
  let index = 0
  while (index < expression.length) {
    const char = expression[index]
    if (/\s/.test(char)) {
      index += 1
      continue
    }
    if (char === '{') {
      const end = expression.indexOf('}', index + 1)
      if (end < 0) throw new FormulaError('注释缺少右花括号')
      index = end + 1
      continue
    }
    if (char === "'" || char === '"') {
      const quote = char
      let end = index + 1
      let value = ''
      while (end < expression.length && expression[end] !== quote) {
        value += expression[end]
        end += 1
      }
      if (end >= expression.length) throw new FormulaError('字符串缺少右引号')
      tokens.push({ kind: 'string', value })
      index = end + 1
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
    if (['>=', '<=', '==', '<>', '!='].includes(two)) {
      tokens.push({ kind: 'op', value: two === '<>' ? '!=' : two })
      index += 2
      continue
    }
    if (two === ':=') {
      tokens.push({ kind: 'op', value: ':=' })
      index += 2
      continue
    }
    if ('+-*/(),<>;:'.includes(char)) {
      tokens.push({ kind: 'op', value: char })
      index += 1
      continue
    }
    throw new FormulaError(`无法识别字符：${char}`)
  }
  tokens.push({ kind: 'eof' })
  return tokens
}

const COLOR_MAP: Record<string, string> = {
  COLORRED: '#e5484d',
  COLORGREEN: '#30a46c',
  COLORBLUE: '#3e63dd',
  COLORYELLOW: '#e8b931',
  COLORWHITE: '#f5f5f5',
  COLORBLACK: '#222222',
  COLORMAGENTA: '#d6409f',
  COLORCYAN: '#00a2c7',
  COLORGRAY: '#8b8d98',
  COLORGREENYELLOW: '#a8d600'
}

class Parser {
  private index = 0

  constructor(
    private readonly tokens: Token[],
    private readonly known: Set<string>
  ) {}

  parseProgram(): Statement[] {
    const statements: Statement[] = []
    while (!this.isEof()) {
      while (this.takeOp(';')) {
        // 允许空语句和尾随分号
      }
      if (this.isEof()) break
      let target: string | undefined
      let display = false
      const first = this.peek()
      const second = this.peekAt(1)
      if (
        first.kind === 'ident' &&
        second.kind === 'op' &&
        (second.value === ':=' || second.value === ':')
      ) {
        target = first.value
        display = second.value === ':'
        if (SERIES_NAMES.has(target)) throw new FormulaError(`不能覆盖内置变量：${target}`)
        this.index += 2
      }
      const node = this.parseExpression()
      let color: string | undefined
      if (this.takeOp(',')) {
        while (!this.isEof()) {
          const token = this.peek()
          if (token.kind === 'op' && token.value === ';') break
          if (token.kind === 'ident') {
            color ??= COLOR_MAP[token.value]
          }
          this.index += 1
        }
      }
      if (!this.takeOp(';') && !this.isEof()) {
        throw new FormulaError('语句之间缺少分号')
      }
      if (target) this.known.add(target)
      statements.push({ target, display, node, color })
    }
    if (statements.length === 0) throw new FormulaError('公式不能为空')
    return statements
  }

  private isEof(): boolean {
    return this.peek().kind === 'eof'
  }

  private peek(): Token {
    return this.tokens[this.index] ?? { kind: 'eof' }
  }

  private peekAt(offset: number): Token {
    return this.tokens[this.index + offset] ?? { kind: 'eof' }
  }

  private takeOp(value: string): boolean {
    const token = this.peek()
    if (token.kind === 'op' && token.value === value) {
      this.index += 1
      return true
    }
    return false
  }

  private parseExpression(): Node {
    return this.comparison()
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
    if (token.kind === 'string') {
      this.index += 1
      return { kind: 'string', value: token.value }
    }
    if (token.kind === 'op' && token.value === '(') {
      this.index += 1
      const node = this.parseExpression()
      if (!this.takeOp(')')) throw new FormulaError('缺少右括号')
      return node
    }
    if (token.kind === 'ident') {
      this.index += 1
      if (this.takeOp('(')) {
        if (!FUNCTIONS.has(token.value)) throw new FormulaError(`未知函数：${token.value}`)
        const args: Node[] = []
        if (!this.takeOp(')')) {
          args.push(this.parseExpression())
          while (this.takeOp(',')) args.push(this.parseExpression())
          if (!this.takeOp(')')) throw new FormulaError(`函数 ${token.value} 缺少右括号`)
        }
        return { kind: 'call', name: token.value, args }
      }
      if (ZERO_ARG_FUNCTIONS.has(token.value)) {
        return { kind: 'call', name: token.value, args: [] }
      }
      if (SERIES_NAMES.has(token.value)) return { kind: 'series', name: token.value }
      if (this.known.has(token.value)) return { kind: 'variable', name: token.value }
      throw new FormulaError(`未知变量：${token.value}`)
    }
    throw new FormulaError('表达式不完整')
  }
}

function lastFinite(values: readonly number[]): number {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    if (Number.isFinite(values[index])) return values[index]
  }
  return Number.NaN
}

function scalar(node: Node, bars: KLineBar[], env: Map<string, number[]>): number {
  const value = lastFinite(evaluate(node, bars, env))
  if (!Number.isFinite(value)) throw new FormulaError('参数必须是有效数字')
  return value
}

function period(node: Node, bars: KLineBar[], env: Map<string, number[]>): number {
  const count = Math.floor(scalar(node, bars, env))
  if (!Number.isFinite(count) || count < 1) throw new FormulaError('周期必须是正整数')
  return count
}

function need(name: string, args: Node[], count: number): void {
  if (args.length !== count) throw new FormulaError(`${name} 需要 ${count} 个参数`)
}

function binarySeries(
  left: number[],
  right: number[],
  operation: (a: number, b: number) => number
): number[] {
  return left.map((value, index) => operation(value, right[index]))
}

function rolling(values: number[], count: number, reducer: (window: number[]) => number): number[] {
  return values.map((_, index) => {
    if (index + 1 < count) return Number.NaN
    const window = values.slice(index - count + 1, index + 1)
    if (window.some((value) => !Number.isFinite(value))) return Number.NaN
    return reducer(window)
  })
}

function populationDeviation(window: number[], sample: boolean): number {
  const mean = window.reduce((sum, value) => sum + value, 0) / window.length
  const divisor = sample ? Math.max(1, window.length - 1) : window.length
  return Math.sqrt(window.reduce((sum, value) => sum + (value - mean) ** 2, 0) / divisor)
}

function drawingResult(node: Node, bars: KLineBar[], env: Map<string, number[]>): number[] {
  if (node.kind === 'number') return bars.map(() => node.value)
  if (node.kind === 'series' || node.kind === 'variable' || node.kind === 'binary') {
    return evaluate(node, bars, env).map((value) => (value > 0 ? 1 : 0))
  }
  if (node.kind === 'call') return evaluate(node, bars, env).map((value) => (value > 0 ? 1 : 0))
  return bars.map(() => 0)
}

function evaluate(node: Node, bars: KLineBar[], env: Map<string, number[]>): number[] {
  switch (node.kind) {
    case 'number':
      return bars.map(() => node.value)
    case 'string':
      throw new FormulaError('字符串只能用于绘图函数')
    case 'series':
      return bars.map((bar) => Number(bar[SERIES[node.name]] ?? Number.NaN))
    case 'variable': {
      const values = env.get(node.name)
      if (!values) throw new FormulaError(`变量尚未赋值：${node.name}`)
      return values
    }
    case 'unary':
      return evaluate(node.arg, bars, env).map((value) => -value)
    case 'binary': {
      const left = evaluate(node.left, bars, env)
      const right = evaluate(node.right, bars, env)
      return binarySeries(left, right, (value, other) => {
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
    case 'call':
      return evaluateCall(node, bars, env)
    default:
      throw new FormulaError('未知表达式')
  }
}

function evaluateCall(
  node: Extract<Node, { kind: 'call' }>,
  bars: KLineBar[],
  env: Map<string, number[]>
): number[] {
  const { name, args } = node
  if (DRAWINGS.has(name)) {
    const required = DRAWING_ARGS[name]
    if (required !== undefined && args.length !== required) {
      throw new FormulaError(`${name} 需要 ${required} 个参数`)
    }
    if (name === 'DRAWKLINE') {
      return evaluate({ kind: 'series', name: 'CLOSE' }, bars, env)
    }
    if (args.length === 0) throw new FormulaError(`${name} 至少需要 1 个参数`)
    return drawingResult(args[0], bars, env)
  }

  switch (name) {
    case 'MA': {
      need(name, args, 2)
      const values = evaluate(args[0], bars, env)
      const count = period(args[1], bars, env)
      return rolling(
        values,
        count,
        (window) => window.reduce((sum, value) => sum + value, 0) / count
      )
    }
    case 'EMA':
    case 'EXPMA':
    case 'EXPMEMA': {
      need(name, args, 2)
      const values = evaluate(args[0], bars, env)
      const count = period(args[1], bars, env)
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
    case 'SMA':
    case 'TMA': {
      need(name, args, 3)
      const values = evaluate(args[0], bars, env)
      const count = period(args[1], bars, env)
      const weight = period(args[2], bars, env)
      if (weight > count) throw new FormulaError(`${name} 的 M 不能大于 N`)
      let previous = Number.NaN
      return values.map((value) => {
        if (!Number.isFinite(value)) return Number.NaN
        previous = Number.isFinite(previous)
          ? (weight * value + (count - weight) * previous) / count
          : value
        return previous
      })
    }
    case 'DMA': {
      need(name, args, 2)
      const values = evaluate(args[0], bars, env)
      let weight = scalar(args[1], bars, env)
      if (weight > 1) weight /= 100
      if (weight < 0 || weight > 1) throw new FormulaError('DMA 的权重必须在 0~1 之间')
      let previous = Number.NaN
      return values.map((value) => {
        if (!Number.isFinite(previous)) {
          previous = value
          return value
        }
        previous = weight * value + (1 - weight) * previous
        return previous
      })
    }
    case 'MEMA':
    case 'XMA': {
      need(name, args, 2)
      const values = evaluate(args[0], bars, env)
      const count = period(args[1], bars, env)
      let previous = Number.NaN
      return values.map((value) => {
        if (!Number.isFinite(previous)) {
          previous = value
          return value
        }
        previous = (value + (count - 1) * previous) / count
        return previous
      })
    }
    case 'WMA': {
      need(name, args, 2)
      const values = evaluate(args[0], bars, env)
      const count = period(args[1], bars, env)
      const divisor = (count * (count + 1)) / 2
      return rolling(
        values,
        count,
        (window) => window.reduce((sum, value, offset) => sum + value * (offset + 1), 0) / divisor
      )
    }
    case 'REF':
    case 'REFV': {
      need(name, args, 2)
      const values = evaluate(args[0], bars, env)
      const count = Math.floor(scalar(args[1], bars, env))
      if (!Number.isFinite(count) || count < 0) throw new FormulaError('REF 的周期不能为负')
      return values.map((_, index) => (index - count >= 0 ? values[index - count] : Number.NaN))
    }
    case 'REFX':
    case 'REFXV': {
      need(name, args, 2)
      const values = evaluate(args[0], bars, env)
      const count = Math.floor(scalar(args[1], bars, env))
      if (!Number.isFinite(count) || count < 0) throw new FormulaError('REFX 的周期不能为负')
      return values.map((_, index) =>
        index + count < values.length ? values[index + count] : Number.NaN
      )
    }
    case 'ABS': {
      need(name, args, 1)
      return evaluate(args[0], bars, env).map((value) => Math.abs(value))
    }
    case 'MAX':
    case 'MIN': {
      need(name, args, 2)
      const left = evaluate(args[0], bars, env)
      const right = evaluate(args[1], bars, env)
      return binarySeries(left, right, (value, other) =>
        name === 'MAX' ? Math.max(value, other) : Math.min(value, other)
      )
    }
    case 'CROSS': {
      need(name, args, 2)
      const left = evaluate(args[0], bars, env)
      const right = evaluate(args[1], bars, env)
      return left.map((value, index) => {
        if (index === 0) return 0
        return value > right[index] && left[index - 1] <= right[index - 1] ? 1 : 0
      })
    }
    case 'LONGCROSS': {
      need(name, args, 3)
      const left = evaluate(args[0], bars, env)
      const right = evaluate(args[1], bars, env)
      const count = period(args[2], bars, env)
      let below = 0
      return left.map((value, index) => {
        if (index === 0) {
          below = value < right[index] ? 1 : 0
          return 0
        }
        const wasBelow = left[index - 1] < right[index - 1]
        below = wasBelow ? below + 1 : 0
        return below >= count && value > right[index] ? 1 : 0
      })
    }
    case 'SUM':
    case 'HHV':
    case 'LLV':
    case 'STD':
    case 'STDP':
    case 'VAR':
    case 'VARP':
    case 'AVEDEV':
    case 'DEVSQ': {
      need(name, args, 2)
      const values = evaluate(args[0], bars, env)
      const count = period(args[1], bars, env)
      return rolling(values, count, (window) => {
        if (name === 'SUM') return window.reduce((sum, value) => sum + value, 0)
        if (name === 'HHV') return Math.max(...window)
        if (name === 'LLV') return Math.min(...window)
        if (name === 'AVEDEV') {
          const mean = window.reduce((sum, value) => sum + value, 0) / window.length
          return window.reduce((sum, value) => sum + Math.abs(value - mean), 0) / window.length
        }
        if (name === 'DEVSQ') {
          const mean = window.reduce((sum, value) => sum + value, 0) / window.length
          return window.reduce((sum, value) => sum + (value - mean) ** 2, 0)
        }
        if (name === 'VAR') return populationDeviation(window, false) ** 2
        if (name === 'VARP') return populationDeviation(window, true) ** 2
        return populationDeviation(window, name === 'STDP')
      })
    }
    case 'IF':
    case 'IFF': {
      need(name, args, 3)
      const condition = evaluate(args[0], bars, env)
      const whenTrue = evaluate(args[1], bars, env)
      const whenFalse = evaluate(args[2], bars, env)
      return condition.map((value, index) =>
        Number.isFinite(value) && value > 0 ? whenTrue[index] : whenFalse[index]
      )
    }
    case 'COUNT':
    case 'EVERY':
    case 'EXIST': {
      need(name, args, 2)
      const values = evaluate(args[0], bars, env)
      const count = period(args[1], bars, env)
      return values.map((_, index) => {
        if (index + 1 < count) return Number.NaN
        const window = values.slice(index - count + 1, index + 1)
        if (name === 'COUNT') return window.filter((value) => value > 0).length
        if (name === 'EVERY') return window.every((value) => value > 0) ? 1 : 0
        return window.some((value) => value > 0) ? 1 : 0
      })
    }
    case 'BARSLAST': {
      need(name, args, 1)
      const values = evaluate(args[0], bars, env)
      let last = -1
      return values.map((value, index) => {
        if (value > 0) last = index
        return last >= 0 ? index - last : Number.NaN
      })
    }
    case 'BARSLASTCOUNT': {
      need(name, args, 1)
      const values = evaluate(args[0], bars, env)
      let run = 0
      return values.map((value) => {
        run = value > 0 ? run + 1 : 0
        return run
      })
    }
    case 'BARSSINCE': {
      need(name, args, 1)
      const values = evaluate(args[0], bars, env)
      const first = values.findIndex((value) => value > 0)
      return values.map((_, index) => (first >= 0 ? index - first : Number.NaN))
    }
    case 'BARSCOUNT': {
      need(name, args, 1)
      const values = evaluate(args[0], bars, env)
      let count = 0
      return values.map((value) => {
        if (Number.isFinite(value)) count += 1
        return count
      })
    }
    case 'HHVBARS':
    case 'LLVBARS': {
      need(name, args, 2)
      const values = evaluate(args[0], bars, env)
      const count = period(args[1], bars, env)
      return rolling(values, count, (window) => {
        const target = name === 'HHVBARS' ? Math.max(...window) : Math.min(...window)
        return window.length - 1 - window.lastIndexOf(target)
      })
    }
    case 'SQRT': {
      need(name, args, 1)
      return evaluate(args[0], bars, env).map((value) =>
        value < 0 ? Number.NaN : Math.sqrt(value)
      )
    }
    case 'POW': {
      need(name, args, 2)
      return binarySeries(
        evaluate(args[0], bars, env),
        evaluate(args[1], bars, env),
        (value, exponent) => value ** exponent
      )
    }
    case 'ROUND':
    case 'INTPART':
    case 'CEILING':
    case 'FLOOR': {
      need(name, args, 1)
      return evaluate(args[0], bars, env).map((value) => {
        if (name === 'ROUND') return Math.round(value)
        if (name === 'INTPART') return Math.trunc(value)
        if (name === 'CEILING') return Math.ceil(value)
        return Math.floor(value)
      })
    }
    case 'SIGN': {
      need(name, args, 1)
      return evaluate(args[0], bars, env).map((value) => Math.sign(value))
    }
    case 'MOD': {
      need(name, args, 2)
      return binarySeries(
        evaluate(args[0], bars, env),
        evaluate(args[1], bars, env),
        (value, divisor) => (divisor === 0 ? Number.NaN : value % divisor)
      )
    }
    case 'LN': {
      need(name, args, 1)
      return evaluate(args[0], bars, env).map((value) => (value > 0 ? Math.log(value) : Number.NaN))
    }
    case 'LOG': {
      need(name, args, 1)
      return evaluate(args[0], bars, env).map((value) =>
        value > 0 ? Math.log10(value) : Number.NaN
      )
    }
    case 'EXP': {
      need(name, args, 1)
      return evaluate(args[0], bars, env).map((value) => Math.exp(value))
    }
    case 'SIN':
    case 'COS':
    case 'TAN':
    case 'ASIN':
    case 'ACOS':
    case 'ATAN': {
      need(name, args, 1)
      return evaluate(args[0], bars, env).map((value) => {
        if (name === 'SIN') return Math.sin(value)
        if (name === 'COS') return Math.cos(value)
        if (name === 'TAN') return Math.tan(value)
        if (name === 'ASIN') return Math.asin(value)
        if (name === 'ACOS') return Math.acos(value)
        return Math.atan(value)
      })
    }
    case 'AND':
    case 'OR': {
      need(name, args, 2)
      const left = evaluate(args[0], bars, env)
      const right = evaluate(args[1], bars, env)
      return binarySeries(left, right, (value, other) =>
        name === 'AND' ? (value > 0 && other > 0 ? 1 : 0) : value > 0 || other > 0 ? 1 : 0
      )
    }
    case 'NOT': {
      need(name, args, 1)
      return evaluate(args[0], bars, env).map((value) => (value > 0 ? 0 : 1))
    }
    case 'RANGE':
    case 'BETWEEN': {
      need(name, args, 3)
      const values = evaluate(args[0], bars, env)
      const lower = evaluate(args[1], bars, env)
      const upper = evaluate(args[2], bars, env)
      return values.map((value, index) => (value >= lower[index] && value <= upper[index] ? 1 : 0))
    }
    case 'RSI': {
      need(name, args, 2)
      const values = evaluate(args[0], bars, env)
      const count = period(args[1], bars, env)
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
      need(name, args, 2)
      const values = evaluate(args[0], bars, env)
      const count = period(args[1], bars, env)
      return rolling(values, count, (window) => {
        const mean = window.reduce((sum, value) => sum + value, 0) / count
        const current = window[window.length - 1]
        return mean === 0 ? Number.NaN : ((current - mean) / mean) * 100
      })
    }
    case 'TR': {
      need(name, args, 0)
      return bars.map((bar, index) => {
        if (index === 0) return bar.high - bar.low
        const previous = bars[index - 1]
        return Math.max(
          bar.high - bar.low,
          Math.abs(bar.high - previous.close),
          Math.abs(bar.low - previous.close)
        )
      })
    }
    case 'ATR': {
      need(name, args, 1)
      const count = period(args[0], bars, env)
      const trueRange = bars.map((bar, index) => {
        if (index === 0) return bar.high - bar.low
        const previous = bars[index - 1]
        return Math.max(
          bar.high - bar.low,
          Math.abs(bar.high - previous.close),
          Math.abs(bar.low - previous.close)
        )
      })
      return rolling(
        trueRange,
        count,
        (window) => window.reduce((sum, value) => sum + value, 0) / count
      )
    }
    case 'FILTER': {
      need(name, args, 2)
      const values = evaluate(args[0], bars, env)
      const count = period(args[1], bars, env)
      let suppressUntil = -1
      return values.map((value, index) => {
        if (index <= suppressUntil || !(value > 0)) return 0
        suppressUntil = index + count - 1
        return 1
      })
    }
    case 'FILTERX': {
      need(name, args, 2)
      const values = evaluate(args[0], bars, env)
      const count = period(args[1], bars, env)
      const result = new Array<number>(values.length).fill(0)
      let suppressUntil = values.length
      for (let index = values.length - 1; index >= 0; index -= 1) {
        if (index >= suppressUntil || !(values[index] > 0)) continue
        result[index] = 1
        suppressUntil = index - count + 1
      }
      return result
    }
    case 'BACKSET': {
      need(name, args, 2)
      const values = evaluate(args[0], bars, env)
      const count = period(args[1], bars, env)
      const result = new Array<number>(values.length).fill(0)
      values.forEach((value, index) => {
        if (!(value > 0)) return
        for (let cursor = Math.max(0, index - count + 1); cursor <= index; cursor += 1) {
          result[cursor] = 1
        }
      })
      return result
    }
    case 'VALUEWHEN': {
      need(name, args, 2)
      const condition = evaluate(args[0], bars, env)
      const values = evaluate(args[1], bars, env)
      let previous = Number.NaN
      return condition.map((value, index) => {
        if (value > 0 && Number.isFinite(values[index])) previous = values[index]
        return previous
      })
    }
    case 'UPNDAY':
    case 'DOWNNDAY': {
      need(name, args, 2)
      const values = evaluate(args[0], bars, env)
      const count = period(args[1], bars, env)
      return values.map((_, index) => {
        if (index < count) return 0
        for (let offset = 0; offset < count; offset += 1) {
          const current = values[index - offset]
          const previous = values[index - offset - 1]
          if (name === 'UPNDAY' ? !(current > previous) : !(current < previous)) return 0
        }
        return 1
      })
    }
    case 'NDAY': {
      need(name, args, 2)
      const values = evaluate(args[0], bars, env)
      const count = period(args[1], bars, env)
      return values.map((_, index) => {
        if (index + 1 < count) return 0
        return values.slice(index - count + 1, index + 1).every((value) => value > 0) ? 1 : 0
      })
    }
    case 'SUMBARS': {
      need(name, args, 2)
      const values = evaluate(args[0], bars, env)
      const target = scalar(args[1], bars, env)
      return values.map((_, index) => {
        let total = 0
        for (let cursor = index; cursor >= 0; cursor -= 1) {
          total += values[cursor]
          if (total >= target) return index - cursor
        }
        return Number.NaN
      })
    }
    case 'CONST': {
      need(name, args, 1)
      const value = lastFinite(evaluate(args[0], bars, env))
      return bars.map(() => value)
    }
    case 'REVERSE': {
      need(name, args, 1)
      return evaluate(args[0], bars, env).map((value) => -value)
    }
    case 'ISLASTBAR': {
      need(name, args, 0)
      return bars.map((_, index) => (index === bars.length - 1 ? 1 : 0))
    }
    case 'CURRBARSCOUNT': {
      need(name, args, 0)
      return bars.map((_, index) => bars.length - index)
    }
    case 'TOTALBARSCOUNT': {
      need(name, args, 0)
      return bars.map(() => bars.length)
    }
    default:
      throw new FormulaError(`未知函数：${name}`)
  }
}

export interface FormulaOutput {
  name: string
  values: number[]
  /** 公式里的 COLORxxx 修饰；没有则使用主题色 */
  color?: string
  /** 该输出来自绘图函数（DRAWTEXT/STICKLINE 等） */
  drawing?: boolean
}

export interface FormulaResult {
  values: number[]
  latest: number | null
  min: number | null
  max: number | null
  /** 多输出公式的全部输出；单表达式时只有一项 */
  outputs?: FormulaOutput[]
}

export interface FormulaDocumentResult {
  outputs: FormulaOutput[]
  primary: FormulaOutput
  variables: Record<string, number[]>
}

function toResult(values: number[]): FormulaResult {
  const finite = values.filter((value) => Number.isFinite(value))
  return {
    values,
    latest: Number.isFinite(values[values.length - 1]) ? values[values.length - 1] : null,
    min: finite.length > 0 ? Math.min(...finite) : null,
    max: finite.length > 0 ? Math.max(...finite) : null
  }
}

/** 求值整段公式，保留全部 `name:...` 输出。 */
export function evaluateFormulaDocument(
  expression: string,
  bars: readonly KLineBar[]
): FormulaDocumentResult {
  const text = expression.trim()
  if (!text) throw new FormulaError('公式不能为空')
  if (text.length > 4000) throw new FormulaError('公式过长（最多 4000 字符）')
  if (bars.length === 0) throw new FormulaError('没有 K 线数据')
  const known = new Set<string>()
  const statements = new Parser(tokenize(text), known).parseProgram()
  const env = new Map<string, number[]>()
  const outputs: FormulaOutput[] = []
  let last: { name: string; values: number[]; drawing?: boolean } | null = null
  for (const statement of statements) {
    const values = evaluate(statement.node, bars as KLineBar[], env)
    if (statement.target) env.set(statement.target, values)
    last = {
      name: statement.target ?? `输出${outputs.length + 1}`,
      values,
      drawing: statement.node.kind === 'call' && DRAWINGS.has(statement.node.name)
    }
    if (statement.display || !statement.target) {
      outputs.push({
        name: last.name,
        values,
        color: statement.color,
        drawing: last.drawing
      })
    }
  }
  // 纯赋值公式没有显式输出时，把最后一条赋值当作显示项，避免“算完什么都没有”。
  if (outputs.length === 0 && last) {
    outputs.push({ name: last.name, values: last.values, drawing: last.drawing })
  }
  if (outputs.length === 0) throw new FormulaError('公式没有输出')
  return {
    outputs,
    primary: outputs[outputs.length - 1],
    variables: Object.fromEntries(env)
  }
}

/** 兼容旧调用：返回最后一个输出，同时把全部输出挂在 `outputs` 上。 */
export function evaluateFormula(expression: string, bars: readonly KLineBar[]): FormulaResult {
  const document = evaluateFormulaDocument(expression, bars)
  return {
    ...toResult(document.primary.values),
    outputs: document.outputs
  }
}
