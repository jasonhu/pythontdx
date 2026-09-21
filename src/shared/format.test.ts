import { describe, expect, it } from 'vitest'
import {
  compactAmount,
  compactCap,
  compactVolume,
  fixed,
  minuteLabel,
  relativeFrom,
  safeNum,
  signed,
  signedPct,
  thousands,
  timeOfDay
} from './format'

describe('safeNum / fixed', () => {
  it('NaN 与 Infinity 一律视为无效', () => {
    expect(safeNum(NaN)).toBeNull()
    expect(safeNum(Infinity)).toBeNull()
    expect(safeNum(undefined)).toBeNull()
    expect(safeNum('12.5')).toBe(12.5)
  })

  it('无效值显示占位符而不是 NaN', () => {
    expect(fixed(NaN)).toBe('—')
    expect(fixed(undefined)).toBe('—')
    expect(fixed(1252.567)).toBe('1252.57')
    expect(fixed(1252.5, 1)).toBe('1252.5')
  })
})

describe('signed / signedPct', () => {
  it('正数带 + 号，负数保留 - 号，零不带符号', () => {
    expect(signed(4.55)).toBe('+4.55')
    expect(signed(-4.55)).toBe('-4.55')
    expect(signed(0)).toBe('0.00')
  })

  it('涨跌幅带百分号，异常值降级为 —%', () => {
    expect(signedPct(1.09)).toBe('+1.09%')
    expect(signedPct(-0.36)).toBe('-0.36%')
    // 昨收为 0 时会算出 Infinity，必须优雅降级（界面上曾出现过这个 —%）
    expect(signedPct(Infinity)).toBe('—%')
    expect(signedPct(undefined)).toBe('—%')
  })
})

describe('compactAmount（金额压缩）', () => {
  it('按万 / 亿 / 万亿自动选单位', () => {
    expect(compactAmount(3_135_910_000)).toBe('31.36亿')
    expect(compactAmount(2_107_000_000)).toBe('21.07亿')
    expect(compactAmount(52_300)).toBe('5.23万')
    expect(compactAmount(3_500_000_000_000)).toBe('3.50万亿')
    expect(compactAmount(880)).toBe('880')
  })

  it('无效值降级', () => {
    expect(compactAmount(undefined)).toBe('—')
  })
})

describe('compactVolume（成交量，单位「手」）', () => {
  it('万手 / 亿手', () => {
    expect(compactVolume(24_830)).toBe('2.48万手')
    expect(compactVolume(248_300)).toBe('24.83万手')
    expect(compactVolume(120_000_000)).toBe('1.20亿手')
    expect(compactVolume(880)).toBe('880手')
  })
})

describe('compactCap（市值，单位「亿元」）', () => {
  it('超过一万亿改用「万亿」', () => {
    expect(compactCap(7769.68)).toBe('7769.68亿')
    expect(compactCap(297_168)).toBe('29.72万亿')
  })
})

describe('thousands', () => {
  it('千分位', () => {
    expect(thousands(1_250_081_601)).toBe('1,250,081,601')
    expect(thousands(0)).toBe('0')
  })
})

describe('时间格式化', () => {
  it('timeOfDay 固定按东八区显示', () => {
    // 2026-09-21T08:14:37Z = 北京时间 16:14:37
    expect(timeOfDay(Date.parse('2026-09-21T08:14:37Z'))).toBe('16:14:37')
  })

  it('minuteLabel 把 HHMM 变成 HH:MM', () => {
    expect(minuteLabel('0930')).toBe('09:30')
    expect(minuteLabel('1500')).toBe('15:00')
  })

  it('relativeFrom 输出人类可读的相对时间', () => {
    const now = Date.parse('2026-09-21T08:00:00Z')
    expect(relativeFrom(now, now)).toBe('刚刚')
    expect(relativeFrom(now - 3_000, now)).toBe('3 秒前')
    expect(relativeFrom(now - 120_000, now)).toBe('2 分钟前')
    expect(relativeFrom(now - 7_200_000, now)).toBe('2 小时前')
  })
})
