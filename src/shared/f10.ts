/**
 * F10 文本 → 结构化块（纯函数，桌面 / Web / 测试共用）。
 *
 * 通达信 0x02d0 返回的是固定宽度文本：表格用 `│` 画列、`├─┼─┤` 画行，
 * 长单元格还会折成两行（第二行只有第一列有字）。直接 `<pre>` 显示时，
 * 中文宽字符会让列全部错位；这里还原成真正的表格并把纯数字列标成右对齐。
 */

export type F10Block =
  | { kind: 'text'; text: string; mono?: boolean }
  | { kind: 'heading'; text: string }
  | { kind: 'link'; url: string }
  | { kind: 'table'; rows: string[][]; numeric: boolean[]; headerless?: boolean }

/** F10 原表的竖线：ULC 框线 │ / 全角 ｜ / ASCII | 三种都出现过。 */
const CELL_EDGE = /[│┃|｜]/
/** 只有框线、没有内容的行（┌──┬──┐ / ├──┼──┤ / └──┴──┘）。 */
const BORDER_ONLY = /^[\s┌┐└┘├┤┬┴┼─━┏┓┗┛┣┫┳┻╋═║]+$/
/** 带拐角/交点的框线才是表格边界；单独一条 ─── 可能只是正文分隔线。 */
const TABLE_JUNCTION = /[┌┐└┘├┤┬┴┼┏┓┗┛┣┫┳┻╋]/
/** 折行尾巴：以右括号/右引号开头，或本身只有 1–3 个字且以它们结尾。 */
const WRAP_TAIL_START = /^[）)\]】]/
const WRAP_TAIL_END = /[）)\]】]$/
/** 空白对齐表的表头分隔线：──────── */
const SPACE_SEPARATOR = /^[─━—═=-]{4,}$/
/** 公司公告/报道里的附件链接 */
const URL_ONLY = /^https?:\/\/[^\s]+$/

/** 中文占两列、英文占一列：判断折行续字属于哪一列时要用。 */
function charWidth(char: string): number {
  return /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/.test(
    char
  )
    ? 2
    : 1
}

/** 每段非空白 token 的起始显示列（折行续字属于哪一列，按这个对齐）。 */
function tokenStarts(line: string): number[] {
  const starts: number[] = []
  let width = 0
  let inToken = false
  for (const char of line) {
    if (char === ' ') {
      inToken = false
      width += 1
      continue
    }
    if (!inToken) {
      starts.push(width)
      inToken = true
    }
    width += charWidth(char)
  }
  return starts
}

function leadingWidth(line: string): number {
  let width = 0
  for (const char of line) {
    if (char !== ' ') break
    width += 1
  }
  return width
}

function numericColumns(rows: string[][], skipFirst = true): boolean[] {
  const width = Math.max(...rows.map((row) => row.length), 0)
  return Array.from({ length: width }, (_, index) => {
    if (index === 0) return false
    const cells = (skipFirst ? rows.slice(1) : rows)
      .map((row) => row[index] ?? '')
      .filter(Boolean)
    if (cells.length === 0) return false
    const numeric = cells.filter((cell) =>
      /^[-+]?[¥￥]?[\d,]+(\.\d+)?%?$/.test(cell.replace(/[—–-]$/, ''))
    )
    return numeric.length / cells.length >= 0.6
  })
}

/** 没有表头、但列之间用两个以上空格对齐的列表（「退出前十大股东」那种）。 */
function readSpaceList(
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
  const numericToken = /^[-+]?[\d,]+(\.\d+)?%?$/
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
  if (rows.length < 3) return null
  const numeric = numericColumns(rows, false)
  if (!numeric.some(Boolean)) return null
  return { block: { kind: 'table', rows, numeric, headerless: true }, next: cursor }
}

/**
 * 解析「空格对齐 + ─── 分隔线」的表格（股东研究、高管治理、机构持股、
 * 资金动向、经营分析、行业分析都用这种）。返回 null 表示不是这种格式。
 */
function readSpaceTable(
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

function splitCells(line: string): string[] {
  return line
    .trim()
    .replace(/^[│┃|｜]/, '')
    .replace(/[│┃|｜]$/, '')
    .split(/[│┃|｜]/)
    .map((cell) => cell.trim())
}

export function parseF10(source: string): F10Block[] {
  const lines = source.replace(/\r\n/g, '\n').split('\n')
  const blocks: F10Block[] = []
  let textLines: string[] = []
  let rows: string[][] = []

  const flushText = (): void => {
    while (textLines.length > 0 && !textLines[0].trim()) textLines.shift()
    while (textLines.length > 0 && !textLines[textLines.length - 1].trim()) textLines.pop()
    if (textLines.length === 0) return

    // 折行的尾巴（"）"、"后）"）接回上一行，避免孤零零一行标点
    const merged: string[] = []
    for (const line of textLines) {
      const text = line.replace(/\s+$/, '')
      const tail = text.trim()
      const wrapTail =
        merged.length > 0 &&
        tail.length > 0 &&
        (WRAP_TAIL_START.test(tail) || (tail.length <= 3 && WRAP_TAIL_END.test(tail)))
      if (wrapTail) merged[merged.length - 1] += tail
      else merged.push(text)
    }

    // 【1.最新提示】这类整行标题单独成块，正文才有层次
    let paragraph: string[] = []
    const flushParagraph = (): void => {
      const text = paragraph.join('\n').trim()
      // 还留着多列对齐空格（没解析成表格）的段落用等宽字体，列才不会散
      const mono = paragraph.some((line) => /\S\s{3,}\S/.test(line))
      if (text) blocks.push({ kind: 'text', text, mono })
      paragraph = []
    }
    for (const line of merged) {
      if (/^【[^】]+】$/.test(line.trim())) {
        flushParagraph()
        blocks.push({ kind: 'heading', text: line.trim() })
      } else {
        paragraph.push(line)
      }
    }
    flushParagraph()
    textLines = []
  }

  const flushTable = (): void => {
    if (rows.length > 0) {
      const width = Math.max(...rows.map((row) => row.length))
      const normalized = rows.map((row) => [
        ...row,
        ...Array.from({ length: width - row.length }, () => '')
      ])
      // 表头折行：单位行（(万股)/(万元)/(%)）接回表头对应列，不能当数据行
      while (normalized.length > 1) {
        const row = normalized[1]!
        const hasUnit = row.some(
          (cell) => /^[(（][^)）]*[)）]$/.test(cell) || /^[%％]$/.test(cell)
        )
        if (!hasUnit || row.some((cell) => cell && /\d/.test(cell))) break
        row.forEach((cell, index) => {
          if (cell && normalized[0]) normalized[0][index] = `${normalized[0][index] ?? ''}${cell}`
        })
        normalized.splice(1, 1)
      }
      if (width < 2 || normalized.length < 2) {
        // 单列/单行不是表：F10 常拿框线包一段公告，硬套 table 只会出怪样式
        const textLinesOut: string[] = []
        for (const row of normalized) {
          const text = row.filter(Boolean).join('  ')
          if (!text) continue
          if (
            textLinesOut.length > 0 &&
            text.length <= 3 &&
            WRAP_TAIL_END.test(text)
          ) {
            textLinesOut[textLinesOut.length - 1] += text
          } else {
            textLinesOut.push(text)
          }
        }
        const text = textLinesOut.join('\n')
        if (text) blocks.push({ kind: 'text', text })
      } else {
        blocks.push({ kind: 'table', rows: normalized, numeric: numericColumns(normalized) })
      }
    }
    rows = []
  }

  const pushRow = (cells: string[]): void => {
    const cleaned = [...cells]
    while (cleaned.length > 0 && !cleaned[cleaned.length - 1]) cleaned.pop()
    if (cleaned.length === 0 || !cleaned.some((cell) => /[\u4e00-\u9fffA-Za-z0-9]/.test(cell))) return
    const tailEmpty = cleaned.length > 1 && cleaned.slice(1).every((cell) => !cell)
    if (tailEmpty && rows.length > 0) {
      // 折行：续行只有第一列有字，接回上一行，别拆成两行
      const previous = rows[rows.length - 1]
      if (previous) previous[0] = `${previous[0] ?? ''}${cleaned[0]}`
      return
    }
    rows.push(cleaned)
  }

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index] ?? ''
    const line = raw.replace(/\s+$/, '')
    const trimmed = line.trim()
    const hasEdge = CELL_EDGE.test(line)
    const border = trimmed.length > 0 && BORDER_ONLY.test(trimmed)

    // 空格对齐表：表头 + ─── 分隔线（股东研究下半段、高管、机构、资金流、经营/行业分析）
    if (SPACE_SEPARATOR.test((lines[index + 1] ?? '').trim())) {
      const parsed = readSpaceTable(lines, index)
      if (parsed) {
        flushTable()
        flushText()
        blocks.push(parsed.block)
        index = parsed.next - 1
        continue
      }
    }

    // 公告/报道里的附件 URL：单独渲染成可点击链接
    if (URL_ONLY.test(trimmed)) {
      flushTable()
      flushText()
      blocks.push({ kind: 'link', url: trimmed.replace(/[.,;，。；]+$/, '') })
      continue
    }

    // 单独的 ─── 分隔线只是版式装饰（小标题下面、表尾），不显示成一行怪字符
    if (SPACE_SEPARATOR.test(trimmed)) {
      flushTable()
      continue
    }

    // 没有表头的空格对齐列表（如「退出前十大流通股东」）：列数固定 + 至少一列数字
    const listTable = readSpaceList(lines, index)
    if (listTable) {
      flushTable()
      flushText()
      blocks.push(listTable.block)
      index = listTable.next - 1
      continue
    }

    if (hasEdge) {
      const cells = splitCells(line)
      // 表格外框/分隔线：丢掉（带拐角的才肯定是表框）
      if (border && TABLE_JUNCTION.test(line)) continue
      const content = cells.filter(Boolean)
      // 宽表里的单格行：短尾巴（"）"、"后）"）接回上一行，其余断开按正文显示
      if (rows.length > 0 && rows.some((row) => row.length > 2) && content.length === 1) {
        const previous = rows[rows.length - 1]
        const tail = content[0] ?? ''
        if (previous && tail.length <= 4 && (previous[0]?.length ?? 0) >= 6) {
          previous[0] = `${previous[0]}${tail}`
        } else {
          flushTable()
          textLines.push(tail)
        }
        continue
      }
      flushText()
      pushRow(cells)
    } else if (border && rows.length > 0) {
      // 表格中部的分隔线：忽略
      continue
    } else if (border && TABLE_JUNCTION.test(line)) {
      // 表格顶/底框线画在正文里时也不要显示成一行怪字符
      continue
    } else {
      flushTable()
      textLines.push(line)
    }
  }
  flushTable()
  flushText()

  // 表格/正文交替处仍可能把折行尾巴切成两个正文块：短尾巴并回上一块
  const mergedBlocks: F10Block[] = []
  for (const block of blocks) {
    const previous = mergedBlocks[mergedBlocks.length - 1]
    if (block.kind !== 'text' || previous?.kind !== 'text') {
      mergedBlocks.push(block)
      continue
    }
    const blockLines = block.text.split('\n')
    const first = (blockLines[0] ?? '').trim()
    const orphan = WRAP_TAIL_START.test(first) || (first.length <= 3 && WRAP_TAIL_END.test(first))
    if (!orphan) {
      mergedBlocks.push(block)
      continue
    }
    previous.text = `${previous.text}${first}`
    const rest = blockLines.slice(1).join('\n').trim()
    if (rest) mergedBlocks.push({ kind: 'text', text: rest })
  }
  return mergedBlocks
}
