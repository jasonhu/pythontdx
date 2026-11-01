/**
 * F10 的两类表格识别：
 *   · 空格对齐 + ─── 分隔线（股东/高管/机构/资金流/经营/行业）
 *   · 空格对齐、无表头的列表（退出前十大股东、经营分析的分段小表）
 *
 * 框线（│）表格在 parse.ts 的 pushRow 里直接收集，不在这里。
 */
import {
  CELL_EDGE,
  SPACE_SEPARATOR,
  leadingWidth,
  tokenStarts,
  type F10Block
} from './model'

export function numericColumns(rows: string[][], skipFirst = true): boolean[] {
  const width = Math.max(...rows.map((row) => row.length), 0)
  return Array.from({ length: width }, (_, index) => {
    if (index === 0) return false
    const cells = (skipFirst ? rows.slice(1) : rows)
      .map((row) => row[index] ?? '')
      .filter(Boolean)
    if (cells.length === 0) return false
    const numeric = cells.filter((cell) =>
      /^[-+]?[¥￥]?[\d,]+(\.\d+)?(亿|万|元|股|手|%)?$/.test(cell.replace(/[—–-]$/, ''))
    )
    return numeric.length / cells.length >= 0.6
  })
}

/** 没有表头、但列之间用两个以上空格对齐的列表（「退出前十大股东」那种）。 */
export function readSpaceList(
  lines: string[],
  index: number
): { block: F10Block; next: number } | null {
  const split = (line: string): string[] =>
    line
      .trim()
      .split(/\s{2,}/)
      .map((cell) => cell.trim())
      .filter(Boolean)
  const first = split(lines[index] ?? '')
  if (first.length < 3) return null
  // 表头行（机构名称/股东名称…）没有数字；从表头开始切会把单位行也当数据
  const numericToken = /^[-+]?[\d,]+(\.\d+)?(亿|万|元|股|手|%)?$/
  if (!first.some((token) => numericToken.test(token))) return null
  const rows: string[][] = []
  let cursor = index
  while (cursor < lines.length) {
    const line = lines[cursor] ?? ''
    const trimmed = line.trim()
    if (!trimmed || CELL_EDGE.test(line) || SPACE_SEPARATOR.test(trimmed)) break
    const cells = split(line)
    if (cells.length === 1 && rows.length > 0) {
      rows[rows.length - 1]![0] = `${rows[rows.length - 1]![0]}${cells[0]}`
      cursor += 1
      continue
    }
    if (cells.length !== first.length) break
    rows.push(cells)
    cursor += 1
  }
  if (rows.length < 2) return null
  const numeric = numericColumns(rows, false)
  if (!numeric.some(Boolean)) return null
  return { block: { kind: 'table', rows, numeric, headerless: true }, next: cursor }
}

/**
 * 解析「空格对齐 + ─── 分隔线」的表格（股东研究、高管治理、机构持股、
 * 资金动向、经营分析、行业分析都用这种）。返回 null 表示不是这种格式。
 */
export function readSpaceTable(
  lines: string[],
  index: number
): { block: F10Block; next: number } | null {
  const header = lines[index] ?? ''
  if (!SPACE_SEPARATOR.test((lines[index + 1] ?? '').trim())) return null

  // 先把表体按「任意空白」切成 token。不能只按两个空格切：像
  // 「均价 剩余股数(万)」这种相邻表头只隔一个空格，会少一列。
  const entries: Array<{ line: string; tokens: string[]; starts: number[] }> = []
  let cursor = index + 2
  while (cursor < lines.length) {
    const line = lines[cursor] ?? ''
    const trimmed = line.trim()
    if (!trimmed) break
    if (SPACE_SEPARATOR.test(trimmed)) {
      cursor += 1
      if (entries.length > 0) break
      continue
    }
    if (/^[【●★]/.test(trimmed)) break
    entries.push({ line, tokens: trimmed.split(/\s+/), starts: tokenStarts(line) })
    cursor += 1
  }
  if (entries.length === 0) return null

  // 以出现最多的 token 数作为列数（折行行只有 1 个 token，不参与投票）
  const votes = new Map<number, number>()
  for (const entry of entries) {
    if (entry.tokens.length < 2) continue
    votes.set(entry.tokens.length, (votes.get(entry.tokens.length) ?? 0) + 1)
  }
  const count = [...votes.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0] ?? 0
  if (count < 2) return null
  // 同一张表里 token 数必须稳定；机构持股的表头会折成两行（(万股)/(万元)），
  // 这种结构硬套表格只会错位，交给正文按等宽显示更安全
  if (entries.some((entry) => entry.tokens.length >= 2 && entry.tokens.length !== count)) {
    return null
  }
  // 表头折行留下的单位行：没有数字，且至少有一个 (万股)/(万元)/(%) token
  const unitRow = (tokens: string[]): boolean =>
    tokens.length > 0 &&
    !tokens.some((token) => /\d/.test(token)) &&
    tokens.some((token) => /^[(（][^)）]*[)）]$/.test(token) || /^[%％]$/.test(token))
  if (entries.slice(0, 3).some((entry) => unitRow(entry.tokens))) return null

  const headerCells = header
    .trim()
    .split(/\s{2,}/)
    .map((cell) => cell.trim())
    .filter(Boolean)
  while (headerCells.length < count) {
    const indexWithSpace = headerCells.findIndex((cell) => /\s/.test(cell))
    if (indexWithSpace < 0) return null
    const parts = headerCells[indexWithSpace]!.split(/\s+/)
    headerCells.splice(indexWithSpace, 1, parts[0]!, parts.slice(1).join(' '))
  }
  if (headerCells.length !== count) return null

  const rows: string[][] = []
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i]!
    if (entry.tokens.length === 1 && rows.length > 0) {
      const previous = rows[rows.length - 1]
      if (!previous) continue
      const offset = leadingWidth(entry.line)
      const previousStarts = entries[i - 1]?.starts ?? []
      let column = 0
      for (let s = 0; s < previousStarts.length && s < count; s += 1) {
        if ((previousStarts[s] ?? Infinity) <= offset) column = s
      }
      previous[column] = `${previous[column] ?? ''}${entry.tokens[0]}`
      continue
    }
    const cells = fitCells(entry.tokens, count)
    if (!cells) return null
    rows.push(cells)
  }
  if (rows.length === 0) return null
  const all = [headerCells, ...rows]
  return {
    block: { kind: 'table', rows: all, numeric: numericColumns(all) },
    next: cursor
  }
}

/** 把 token 数凑成列数：多了合并最靠右的两个非数字 token，少了把「数字+中文」拆开。 */
function fitCells(cells: string[], count: number): string[] | null {
  const out = [...cells]
  const numeric = (text: string): boolean => /^[-+]?[\d,]+(\.\d+)?%?$/.test(text.replace(/[—–-]$/, ''))
  while (out.length > count) {
    let mergeAt = -1
    for (let i = out.length - 2; i >= 0; i -= 1) {
      if (!numeric(out[i] ?? '') && !numeric(out[i + 1] ?? '')) {
        mergeAt = i
        break
      }
    }
    if (mergeAt < 0) mergeAt = out.length - 2
    out.splice(mergeAt, 2, `${out[mergeAt] ?? ''}${out[mergeAt + 1] ?? ''}`)
  }
  while (out.length < count) {
    const index = out.findIndex((cell) => /^\S+\s+\S/.test(cell))
    if (index < 0) return null
    const parts = out[index]!.split(/\s+/)
    const head = parts[0]
    if (!head) return null
    out.splice(index, 1, head, parts.slice(1).join(' '))
  }
  return out
}

export function splitCells(line: string): string[] {
  return line
    .trim()
    .replace(/^[│┃|｜]/, '')
    .replace(/[│┃|｜]$/, '')
    .split(/[│┃|｜]/)
    .map((cell) => cell.trim())
}
