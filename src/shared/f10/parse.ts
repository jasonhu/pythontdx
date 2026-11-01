/**
 * F10 文本 → 结构化块（纯函数，桌面 / Web / 测试共用）。
 *
 * 通达信 0x02d0 返回的是固定宽度文本：表格用 `│` 画列、`├─┼─┤` 画行，
 * 长单元格还会折成两行（第二行只有第一列有字）。直接 `<pre>` 显示时，
 * 中文宽字符会让列全部错位；这里还原成真正的表格并把纯数字列标成右对齐。
 */
import {
  BORDER_ONLY,
  CELL_EDGE,
  SPACE_SEPARATOR,
  TABLE_JUNCTION,
  URL_ONLY,
  WRAP_TAIL_END,
  WRAP_TAIL_START,
  type F10Block
} from './model'
import {
  numericColumns,
  readSpaceList,
  readSpaceTable,
  splitCells
} from './tables'
import { attachTableLinks, compactLinkDetails } from './links'

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
    let intro = false
    let paragraph: string[] = []
    const flushParagraph = (): void => {
      const text = paragraph.join('\n').trim()
      // 还留着多列对齐空格（没解析成表格）的段落用等宽字体，列才不会散
      const mono = paragraph.some((line) => /\S\s{3,}\S/.test(line))
      if (text) blocks.push({ kind: 'text', text, mono })
      paragraph = []
    }
    for (const line of merged) {
      const trimmed = line.trim()
      const headingLine = /^【[^】]+】$/.test(trimmed)
      if (headingLine && !intro) {
        flushParagraph()
        blocks.push({ kind: 'heading', text: trimmed })
        continue
      }
      paragraph.push(line)
      // 「★本栏包括…」会折行，续行的【5.xxx】仍属于说明，不能当章节标题
      if (trimmed.startsWith('★本栏包括')) intro = true
      else if (!trimmed.includes('【')) intro = false
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
      // 「公司名称 | 值」这种 2~4 列的键值表：按表格渲染会把长英文值撑成一列巨宽，
      // 右侧键名被挤成竖排；改成 label/value 列表更清晰
      const pairRows = normalized.filter((row) => {
        const filled = row.filter(Boolean)
        return filled.length === 2 && Boolean(row[0]) && Boolean(row[1])
      }).length
      if (width >= 3 && pairRows >= Math.ceil(normalized.length * 0.6)) {
        const pairs: Array<{ label: string; value: string }> = []
        for (const row of normalized) {
          if (row[0] && row[1]) pairs.push({ label: row[0], value: row[1] })
          if (row[2] && row[3]) pairs.push({ label: row[2], value: row[3] })
        }
        if (pairs.length > 0) {
          blocks.push({ kind: 'kv', pairs })
          rows = []
          return
        }
      }
      if (width < 2 || normalized.length < 2) {
        // 单列/单行不是表：F10 常拿框线包一段公告，硬套 table 只会出怪样式
        const textLinesOut: string[] = []
        for (const row of normalized) {
          const text = row.filter(Boolean).join('  ')
          if (!text) continue
          if (textLinesOut.length > 0 && text.length <= 3 && WRAP_TAIL_END.test(text)) {
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
    if (cleaned.length === 0) return
    if (rows.length > 0) {
      const previous = rows[rows.length - 1]!
      const tailEmpty = cleaned.length > 1 && cleaned.slice(1).every((cell) => !cell)
      const headEmpty = cleaned.length > 1 && !cleaned[0]
      if (tailEmpty) {
        // 折行：续行只有第一列有字，接回上一行第一列
        previous[0] = `${previous[0] ?? ''}${cleaned[0]}`
        return
      }
      if (cleaned.length === 1 && previous.length > 1) {
        // 多列表里的名称折行（如「苏州朝希…/业投资合伙企业/…」），接回上一行；
        // 单列表（一列框线包一段公告）必须保留换行，不能把整段并成一行
        previous[0] = `${previous[0] ?? ''}${cleaned[0]}`
        return
      }
      if (headEmpty) {
        // 第一列空、其它列续字：每一列都接回上一行（经营范围、控股关系、表头单位行）
        let merged = false
        cleaned.forEach((cell, index) => {
          if (index === 0 || !cell) return
          previous[index] = `${previous[index] ?? ''}${cell}`
          merged = true
        })
        if (merged) return
      }
    }
    if (!cleaned.some((cell) => /[\u4e00-\u9fffA-Za-z0-9]/.test(cell))) return
    rows.push(cleaned)
  }

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index] ?? ''
    const line = raw.replace(/\s+$/, '')
    const trimmed = line.trim()
    const hasEdge = CELL_EDGE.test(line)
    const border = trimmed.length > 0 && BORDER_ONLY.test(trimmed)

    // 只有 ┴、没有 ┼ 的框线是表尾/列跨度结束：先收表，后面的单列段落才不会被并进上一行
    if (border && line.includes('┴') && !line.includes('┼')) {
      flushTable()
      continue
    }

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
      const previous = blocks[blocks.length - 1]
      const listRows = listTable.block.kind === 'table' ? listTable.block.rows : []
      const sameColumns =
        previous?.kind === 'table' &&
        listRows.length > 0 &&
        previous.rows[0]?.length === listRows[0]?.length
      // 同一张表被 ─── 分成几段（经营分析的行业/产品/地区/销售模式）：
      // 列数一致且中间没有标题，就接回上一张表，共用表头
      if (sameColumns && previous?.kind === 'table') {
        previous.rows.push(...listRows.map((row) => [...row]))
        previous.numeric = numericColumns(previous.rows)
      } else {
        blocks.push(listTable.block)
      }
      index = listTable.next - 1
      continue
    }

    if (hasEdge) {
      const cells = splitCells(line)
      // 表格外框/分隔线：丢掉（带拐角的才肯定是表框）
      if (border && TABLE_JUNCTION.test(line)) continue
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
  attachTableLinks(mergedBlocks)
  compactLinkDetails(mergedBlocks)
  return mergedBlocks
}
