/** 纯函数 CSV 编码：桌面 / Web 共用，不依赖 DOM。 */
function cell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ''
  const text = String(value)
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function toCsv(
  columns: readonly string[],
  rows: ReadonlyArray<ReadonlyArray<string | number | null | undefined>>
): string {
  return [columns.map(cell).join(','), ...rows.map((row) => row.map(cell).join(','))].join('\n')
}
