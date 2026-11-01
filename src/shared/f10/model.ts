/**
 * F10 解析的公共类型与正则。
 *
 * 单独放一层是为了让「表格识别」「链接归并」「主流程」三个模块共用同一份
 * 框线/折行定义，避免常量在各处复制。
 */

export type F10Block =
  | { kind: 'text'; text: string; mono?: boolean }
  | { kind: 'heading'; text: string }
  | { kind: 'link'; url: string }
  | {
      kind: 'table'
      rows: string[][]
      numeric: boolean[]
      headerless?: boolean
      /** 与 rows 对齐的外部链接（公告/报道明细） */
      links?: Array<string | undefined>
    }
  | { kind: 'kv'; pairs: Array<{ label: string; value: string }> }

/** F10 原表的竖线：ULC 框线 │ / 全角 ｜ / ASCII | 三种都出现过。 */
export const CELL_EDGE = /[│┃|｜]/
/** 只有框线、没有内容的行（┌──┬──┐ / ├──┼──┤ / └──┴──┘）。 */
export const BORDER_ONLY = /^[\s┌┐└┘├┤┬┴┼─━┏┓┗┛┣┫┳┻╋═║]+$/
/** 带拐角/交点的框线才是表格边界；单独一条 ─── 可能只是正文分隔线。 */
export const TABLE_JUNCTION = /[┌┐└┘├┤┬┴┼┏┓┗┛┣┫┳┻╋]/
/** 折行尾巴：以右括号/右引号开头，或本身只有 1–3 个字且以它们结尾。 */
export const WRAP_TAIL_START = /^[）)\]】]/
export const WRAP_TAIL_END = /[）)\]】]$/
/** 空白对齐表的表头分隔线：──────── */
export const SPACE_SEPARATOR = /^[─━—═=-]{4,}$/
/** 公司公告/报道里的附件链接 */
export const URL_ONLY = /^https?:\/\/[^\s]+$/

/** 中文占两列、英文占一列：判断折行续字属于哪一列时要用。 */
export function charWidth(char: string): number {
  return /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/.test(
    char
  )
    ? 2
    : 1
}

/** 每段非空白 token 的起始显示列（折行续字属于哪一列，按这个对齐）。 */
export function tokenStarts(line: string): number[] {
  const starts: number[] = []
  let width = 0
  let inToken = false
  for (const char of line) {
    if (char === ' ') {
      inToken = false
      width += 1
      continue
    }
    if (!inToken) {
      starts.push(width)
      inToken = true
    }
    width += charWidth(char)
  }
  return starts
}

export function leadingWidth(line: string): number {
  let width = 0
  for (const char of line) {
    if (char !== ' ') break
    width += 1
  }
  return width
}
