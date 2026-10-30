/**
 * 本地搜索索引测试。
 *
 * 通达信代码表不带拼音，拼音是 pinyin-pro 在本地补的；
 * 这些用例锁住「首字母 / 全拼 / 中文 / 代码」四条路径。
 */
import { describe, expect, it } from 'vitest'
import { buildSearchEntries, searchEntries } from './search'
import type { SecurityInfo } from './types'

const ITEMS: SecurityInfo[] = [
  { code: 'sh600519', market: 'SH', symbol: '600519', name: '贵州茅台', decimal: 2, kind: 'GP-A' },
  { code: 'sz000858', market: 'SZ', symbol: '000858', name: '五粮液', decimal: 2, kind: 'GP-A' },
  { code: 'sh601318', market: 'SH', symbol: '601318', name: '中国平安', decimal: 2, kind: 'GP-A' }
]

const ENTRIES = buildSearchEntries(ITEMS)

describe('searchEntries', () => {
  it('支持首字母缩写', () => {
    expect(searchEntries(ENTRIES, 'gzmt')[0]?.code).toBe('sh600519')
    expect(searchEntries(ENTRIES, 'wly')[0]?.code).toBe('sz000858')
    expect(searchEntries(ENTRIES, 'zgpa')[0]?.code).toBe('sh601318')
  })

  it('支持全拼、中文名和代码', () => {
    expect(searchEntries(ENTRIES, 'guizhou')[0]?.code).toBe('sh600519')
    expect(searchEntries(ENTRIES, '茅台')[0]?.code).toBe('sh600519')
    expect(searchEntries(ENTRIES, '600519')[0]?.code).toBe('sh600519')
  })

  it('空关键词返回空', () => {
    expect(searchEntries(ENTRIES, '   ')).toEqual([])
  })

  it('没有匹配时返回空数组', () => {
    expect(searchEntries(ENTRIES, 'zzzzzz')).toEqual([])
  })
})
