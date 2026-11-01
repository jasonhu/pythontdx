import { describe, expect, it } from 'vitest'
import { parseF10 } from './f10'

const table = (rows: string[]): string => rows.join('\n')

describe('parseF10', () => {
  it('把 ULC 框线表还原成表格，并合并折行的第一列', () => {
    const source = table([
      '●最新主要指标',
      '┌──────────────┬────────────┬────────────┐',
      '│●最新主要指标 │ 2026-09-30 │ 2026-06-30 │',
      '├──────────────┼────────────┼────────────┤',
      '│每股收益(元)  │     0.3200 │     0.2300 │',
      '│加权净资产收益率(%│    2.3000 │    1.6700 │',
      '│)             │            │            │',
      '└──────────────┴────────────┴────────────┘'
    ])
    const blocks = parseF10(source)
    const parsed = blocks.find((block) => block.kind === 'table')
    expect(parsed?.kind).toBe('table')
    if (parsed?.kind !== 'table') return
    expect(parsed.rows[0]).toEqual(['●最新主要指标', '2026-09-30', '2026-06-30'])
    expect(parsed.rows[1]).toEqual(['每股收益(元)', '0.3200', '0.2300'])
    // 折行尾巴 ")" 接回上一行，而不是单独一行
    expect(parsed.rows[2]?.[0]).toBe('加权净资产收益率(%)')
    expect(parsed.numeric).toEqual([false, true, true])
    expect(blocks.some((block) => block.kind === 'text' && /[│┌└]/.test(block.text))).toBe(false)
  })

  it('单列框线只是包了一段公告，按正文输出而不是表格', () => {
    const source = table([
      '┌──────────────────────────────┐',
      '│●最新公告:2026-10-30 利元亨（688499）│',
      '│后）                          │',
      '└──────────────────────────────┘'
    ])
    const blocks = parseF10(source)
    expect(blocks.some((block) => block.kind === 'table')).toBe(false)
    const text = blocks
      .filter((block) => block.kind === 'text')
      .map((block) => block.text)
      .join('\n')
    expect(text).toContain('●最新公告')
    expect(text).toContain('后）')
    expect(text).not.toContain('│')
  })

  it('【标题】单独成块，正文按原顺序保留', () => {
    const blocks = parseF10('前言\n【1.最新提示】\n正文一\n正文二')
    expect(blocks.map((block) => block.kind)).toEqual(['text', 'heading', 'text'])
    expect(blocks[1]).toMatchObject({ kind: 'heading', text: '【1.最新提示】' })
  })

  it('兼容全角 ｜ 与 ASCII | 分隔，并去掉表头分隔线', () => {
    const source = table(['名称｜数值', ':--|--:', '营收｜123.45'])
    const blocks = parseF10(source)
    const parsed = blocks.find((block) => block.kind === 'table')
    if (parsed?.kind !== 'table') throw new Error('没有解析出表格')
    expect(parsed.rows).toEqual([
      ['名称', '数值'],
      ['营收', '123.45']
    ])
    expect(parsed.numeric).toEqual([false, true])
  })

  it('把折行尾巴接回上一行，不单独一行标点', () => {
    const blocks = parseF10('●公告（详见\n后）\n●下一条')
    const text = blocks
      .filter((block) => block.kind === 'text')
      .map((block) => block.text)
      .join('\n')
    expect(text).toContain('●公告（详见后）')
    expect(text).not.toMatch(/^后）$/m)
  })
})
