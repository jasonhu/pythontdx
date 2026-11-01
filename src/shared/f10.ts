/**
 * F10 文本 → 结构化块（纯函数，桌面 / Web / 测试共用）。
 *
 * 通达信 0x02d0 返回的是固定宽度文本：表格用 `│` 画列、`├─┼─┤` 画行，
 * 长单元格还会折成两行（第二行只有第一列有字）。直接 `<pre>` 显示时，
 * 中文宽字符会让列全部错位；这里还原成真正的表格并把纯数字列标成右对齐。
 */

export type F10Block =
  | { kind: 'text'; text: string }
  | { kind: 'heading'; text: string }
  | { kind: 'table'; rows: string[][]; numeric: boolean[] }

/** F10 原表的竖线：ULC 框线 │ / 全角 ｜ / ASCII | 三种都出现过。 */
const CELL_EDGE = /[│┃|｜]/
/** 只有框线、没有内容的行（┌──┬──┐ / ├──┼──┤ / └──┴──┘）。 */
const BORDER_ONLY = /^[\s┌┐└┘├┤┬┴┼─━┏┓┗┛┣┫┳┻╋═║]+$/
/** 带拐角/交点的框线才是表格边界；单独一条 ─── 可能只是正文分隔线。 */
const TABLE_JUNCTION = /[┌┐└┘├┤┬┴┼┏┓┗┛┣┫┳┻╋]/
/** 折行尾巴：以右括号/右引号开头，或本身只有 1–3 个字且以它们结尾。 */
const WRAP_TAIL_START = /^[）)\]】]/
const WRAP_TAIL_END = /[）)\]】]$/

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
      if (text) blocks.push({ kind: 'text', text })
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
        const numeric = Array.from({ length: width }, (_, index) => {
          if (index === 0) return false
          const cells = normalized
            .slice(1)
            .map((row) => row[index] ?? '')
            .filter(Boolean)
          if (cells.length === 0) return false
          const numericCells = cells.filter((cell) =>
            /^[-+]?[¥￥]?[\d,]+(\.\d+)?%?$/.test(cell.replace(/[—–-]$/, ''))
          )
          return numericCells.length / cells.length >= 0.6
        })
        blocks.push({ kind: 'table', rows: normalized, numeric })
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

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '')
    const hasEdge = CELL_EDGE.test(line)
    const trimmed = line.trim()
    const border = trimmed.length > 0 && BORDER_ONLY.test(trimmed)
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
