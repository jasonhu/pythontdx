/** 把 F10 表格/列表转成稳定的 Markdown，便于复制到笔记或喂给模型。 */

export function escapeCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—'
  return String(value).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
}

export function markdownTable(
  columns: readonly string[],
  rows: ReadonlyArray<ReadonlyArray<string | number | null | undefined>>
): string {
  if (columns.length === 0) return '> 暂无数据\n'
  const head = `| ${columns.map(escapeCell).join(' | ')} |`
  const sep = `| ${columns.map(() => '---').join(' | ')} |`
  const body = rows.map((row) => `| ${row.map(escapeCell).join(' | ')} |`).join('\n')
  return `${head}\n${sep}${body ? `\n${body}` : ''}\n`
}

export function markdownSection(heading: string, body: string): string {
  return `## ${heading}\n\n${body.trim()}\n`
}

export function markdownDocument(title: string, sections: readonly string[]): string {
  return `# ${title}\n\n${sections.join('\n\n')}`
}
