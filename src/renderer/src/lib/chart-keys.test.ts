import { describe, expect, it } from 'vitest'
import { chartOwnsKeys } from './chart-keys'

describe('K 线图该不该接住这次按键', () => {
  it('鼠标停在图上（一次都没点过）→ 要接', () => {
    // 这正是用户第一次用键盘的路径：点完「日K」标签，鼠标移到图上直接按 ↑。
    // 那一刻焦点还留在 tab 按钮上，图要是只监听自己，按键就永远到不了它 ——
    // 用户看到的就是「没反应 + 焦点框跑到标签上」
    expect(chartOwnsKeys({ hovering: true, chartFocused: false, typing: false })).toBe(true)
  })

  it('图自己有焦点（点过图，或用 Tab 走过来的）→ 要接', () => {
    expect(chartOwnsKeys({ hovering: false, chartFocused: true, typing: false })).toBe(true)
  })

  it('鼠标不在图上、图也没有焦点 → 不接，别抢别人的按键', () => {
    expect(chartOwnsKeys({ hovering: false, chartFocused: false, typing: false })).toBe(false)
  })

  it('正在输入框里打字 → 一律不接（搜索框要拿 ↑↓ 选候选）', () => {
    expect(chartOwnsKeys({ hovering: true, chartFocused: false, typing: true })).toBe(false)
    expect(chartOwnsKeys({ hovering: true, chartFocused: true, typing: true })).toBe(false)
  })
})
