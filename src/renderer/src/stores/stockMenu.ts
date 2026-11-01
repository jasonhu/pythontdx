/**
 * 个股右键菜单的全局状态。
 *
 * 为什么不做成每个列表各自的弹层：全市场、板块、排行、选股结果都需要同一个菜单，
 * 每处复制一份状态与定位逻辑必然走样。这里只存「点了谁、点在哪个坐标」，
 * 由 App 挂一个 `<StockMenu />` 统一渲染。
 */
import { createSignal } from 'solid-js'

export interface StockMenuTarget {
  code: string
  name: string
  x: number
  y: number
}

const [stockMenu, setStockMenu] = createSignal<StockMenuTarget | null>(null)

export { stockMenu }

/** 列表行里直接调用：`onContextMenu={(event) => openStockMenu(event, item)}` */
export function openStockMenu(event: MouseEvent, target: { code: string; name: string }): void {
  event.preventDefault()
  event.stopPropagation()
  setStockMenu({ code: target.code, name: target.name, x: event.clientX, y: event.clientY })
}

export function closeStockMenu(): void {
  setStockMenu(null)
}
