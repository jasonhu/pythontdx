import { describe, expect, it } from 'vitest'
import { markdownDocument, markdownTable } from './markdown'

describe('markdownTable', () => {
  it('转义竖线并保留空值占位', () => {
    const text = markdownTable(
      ['名称', '备注'],
      [
        ['贵州茅台', 'A|B'],
        ['', null]
      ]
    )
    expect(text).toContain('| 名称 | 备注 |')
    expect(text).toContain('| 贵州茅台 | A\\|B |')
    expect(text).toContain('| — | — |')
  })
})

describe('markdownDocument', () => {
  it('生成标题与分区', () => {
    const text = markdownDocument('F10', ['## 概况\n\n内容'])
    expect(text).toBe('# F10\n\n## 概况\n\n内容')
  })
})
