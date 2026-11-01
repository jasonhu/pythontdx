/**
 * F10 解析入口（保持原有 import 路径不变）。
 *
 * 实现拆在 `f10/` 下：
 *   model.ts  — 类型、框线/折行/URL 正则、CJK 列宽
 *   tables.ts — 空格对齐表、无表头列表、数字列判定
 *   links.ts  — 公告/报道的 URL 归并与去重
 *   parse.ts  — 主循环（框线表收集、标题/正文分层）
 */
export { parseF10 } from './f10/parse'
export type { F10Block } from './f10/model'
