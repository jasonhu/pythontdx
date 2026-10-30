import { describe, expect, it } from 'vitest'
import { toCsv } from './csv'

describe('toCsv', () => {
  it('转义逗号、引号和换行', () => {
    expect(
      toCsv(
        ['a', 'b'],
        [
          ['x,y', 'z"q'],
          ['line1\nline2', 1]
        ]
      )
    ).toBe('a,b\n"x,y","z""q"\n"line1\nline2",1')
  })

  it('空值写空字符串', () => {
    expect(toCsv(['a', 'b'], [[null, undefined]])).toBe('a,b\n,')
  })
})
