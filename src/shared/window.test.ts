import { describe, expect, it } from 'vitest'
import { centerOnWorkArea } from './window'

describe('centerOnWorkArea', () => {
  it('在主屏工作区居中', () => {
    expect(
      centerOnWorkArea({ width: 1600, height: 900 }, { x: 0, y: 24, width: 1920, height: 1056 })
    ).toEqual({ x: 160, y: 102 })
  })

  it('支持左侧/上方负坐标副屏', () => {
    expect(
      centerOnWorkArea(
        { width: 1200, height: 800 },
        { x: -1920, y: -1080, width: 1920, height: 1080 }
      )
    ).toEqual({ x: -1560, y: -940 })
  })

  it('窗口大于工作区时贴左上角，不产生负偏移', () => {
    expect(
      centerOnWorkArea({ width: 2200, height: 1200 }, { x: 100, y: 50, width: 1920, height: 1080 })
    ).toEqual({ x: 100, y: 50 })
  })
})
