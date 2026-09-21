/**
 * 与 DOM / 响应式相关的小工具。
 *
 * SolidJS 没有 React 那样的 hook 生态，这些「组合式函数」就是它的地道写法：
 * 在组件作用域内调用，用 createSignal 存状态、用 onCleanup 收尾。
 */
import { createEffect, createSignal, onCleanup, type Accessor } from 'solid-js'

export interface ElementSize {
  width: number
  height: number
}

/**
 * 观察元素的实时尺寸。
 *
 * 图表为什么要自己量尺寸，而不是用 SVG 的 viewBox 缩放？
 * 因为 viewBox 缩放会把线宽、文字一起拉伸变形；按真实像素绘制才是清晰的关键。
 *
 * @returns size 只读尺寸信号；ref 传给需要测量的元素
 */
export function useElementSize<T extends HTMLElement>(): {
  size: Accessor<ElementSize>
  ref: (element: T) => void
} {
  const [size, setSize] = createSignal<ElementSize>({ width: 0, height: 0 })
  let observer: ResizeObserver | null = null

  const ref = (element: T): void => {
    observer?.disconnect()
    observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect
      if (!rect) return
      const width = Math.round(rect.width)
      const height = Math.round(rect.height)
      // 尺寸没变就不要写信号：既省一次重绘，也避免触发
      // "ResizeObserver loop completed with undelivered notifications" 的告警
      setSize((previous) =>
        previous.width === width && previous.height === height ? previous : { width, height }
      )
    })
    observer.observe(element)
  }

  onCleanup(() => observer?.disconnect())

  return { size, ref }
}

export type FlashDirection = 'up' | 'down' | null

/**
 * 数值变化时给出一次「涨/跌」方向信号，持续 duration 毫秒后自动复位。
 * 用于价格跳动时的高亮闪烁——行情软件的灵魂细节。
 */
export function createValueFlash(
  value: Accessor<number | null | undefined>,
  duration = 700
): Accessor<FlashDirection> {
  const [direction, setDirection] = createSignal<FlashDirection>(null)
  let previous: number | undefined

  createEffect(() => {
    const current = value()
    if (current === null || current === undefined || !Number.isFinite(current)) return

    if (previous !== undefined && current !== previous) {
      setDirection(current > previous ? 'up' : 'down')
      const timer = setTimeout(() => setDirection(null), duration)
      // 下一次数值变化前先清掉上一个定时器，避免闪烁叠加
      onCleanup(() => clearTimeout(timer))
    }
    previous = current
  })

  return direction
}

/** 判断元素是否处于「可见」状态的简易节流计时器 */
export function createInterval(callback: () => void, intervalMs: Accessor<number>): void {
  createEffect(() => {
    const interval = intervalMs()
    const timer = setInterval(callback, interval)
    onCleanup(() => clearInterval(timer))
  })
}
