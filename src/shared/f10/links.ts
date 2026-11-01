/**
 * 公告/报道链接的后处理。
 *
 * 主站会在正文里重复「标题 + 附件 URL」，有时还先给一张摘要表。
 * 这里把 URL 挂到摘要表的行上，或去掉重复明细，让一条公告只剩一行标题。
 */
import type { F10Block } from './model'

/**
 * 摘要表 + 明细链接：
 *   · 链接数 = 表行数 → 按行挂 URL，收起明细
 *   · 链接数 > 表行数 → 摘要只是前 10 条，删表保留更全的明细
 */
export function attachTableLinks(blocks: F10Block[]): void {
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const table = blocks[index]
    if (table?.kind !== 'table') continue
    const tail = blocks.slice(index + 1)
    if (
      tail.some(
        (block) => block.kind === 'heading' || block.kind === 'table' || block.kind === 'kv'
      )
    ) {
      continue
    }
    const links = tail.filter((block) => block.kind === 'link').map((block) => block.url)
    const offset = table.headerless ? 0 : 1
    const dataRows = table.rows.length - offset
    // 只处理公告表：首列是日期；避免把普通数据表后面的新闻链接误当公告明细
    const announcement =
      dataRows > 0 &&
      table.rows.slice(offset).every((row) => /^\d{4}-\d{2}-\d{2}/.test((row[0] ?? '').trim()))
    if (links.length === 0 || !announcement) continue
    if (links.length === dataRows) {
      table.links = table.rows.map((_, row) =>
        row >= offset ? links[row - offset] : undefined
      )
      blocks.splice(index + 1, tail.length)
      return
    }
    if (links.length > dataRows) {
      blocks.splice(index, 1)
      return
    }
  }
}

/** 明细里的「…公告详情请查看附件」、重复标题行都去掉，只留「日期 + 标题」 */
export function compactLinkDetails(blocks: F10Block[]): void {
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    if (blocks[index]?.kind !== 'link') continue
    const previous = blocks[index - 1]
    if (previous?.kind !== 'text') continue
    const lines = previous.text
      .split('\n')
      .map((line) => line.replace(/。?公告详情请查看附件.*$/, '').trim())
      .filter(Boolean)
      // 明细第二行常常只是标题的重复（「利元亨（688499）：…」），只保留带日期的首行
      .filter((line, lineIndex) => lineIndex === 0 || !/^.{1,12}（\d{6}）：/.test(line))
    if (lines.length === 0) {
      blocks.splice(index - 1, 1)
      continue
    }
    previous.text = lines.join('\n')
    // 标题被拆成「日期+标题」和「标题」两块时，保留带日期的那块
    const before = blocks[index - 2]
    if (
      before?.kind === 'text' &&
      previous.text.length < 160 &&
      !/^\d{4}-/.test(previous.text) &&
      before.text.includes(previous.text)
    ) {
      blocks.splice(index - 1, 1)
    }
  }
}
