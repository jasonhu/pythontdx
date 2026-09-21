/**
 * K 线图该不该接住这次按键？
 *
 * 为什么单独抽成一个函数：这个判断**曾经是隐式的** —— 图表只挂了自己的 `onKeyDown`，
 * 于是「鼠标停在图上按 ↑」什么都不会发生。用户第一次用键盘就是这么被绊住的：
 * 点完「日K」标签，焦点留在那个按钮上，按键落在按钮上，图一动不动，
 * 而 Chrome 因为「发生了键盘操作」把焦点圈画到了按钮上 ——
 * 看起来就像「焦点跑到上面的标签上去了」。
 *
 * 为什么要给「鼠标悬停」一路：滚轮**不用点**就能用，键盘却要点一下才生效，
 * 同一个图表两套规则，第一次必然踩空。主流行情软件的规则是
 * 「指针在哪张图上，快捷键就归哪张图」。
 *
 * 规则本身与 DOM 无关，是纯粹的判断，所以放在这里单测（组件那边只负责取值）。
 */
export interface ChartKeyContext {
  /** 鼠标是否停在图表上 */
  hovering: boolean
  /** 图表自己是否持有焦点（点过它，或用 Tab 走过来） */
  chartFocused: boolean
  /** 事件落点是否在输入框里 —— 这种情况下谁也别抢 */
  typing: boolean
}

/** 指针在图上、或图有焦点时，方向键 / End / Esc 归这张图；正在打字时一律让路 */
export function chartOwnsKeys(context: ChartKeyContext): boolean {
  if (context.typing) return false
  return context.hovering || context.chartFocused
}