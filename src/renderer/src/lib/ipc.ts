/**
 * preload 桥的渲染进程入口。
 *
 * window.api 的类型由 src/preload/index.d.ts 提供，这里只是给它一个本地别名，
 * 好处是将来要加「统一的错误处理 / 打点」时，只改这一个文件。
 */
import type { StockLensApi } from '@shared/ipc'

export const api: StockLensApi = window.api

/**
 * 把主进程抛出的异常洗成人话。
 * Electron 会把错误包装成 "Error invoking remote method 'x': Error: 真正的信息"，
 * 直接展示给用户太丑，这里统一剥壳。
 */
export function errorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  return (
    raw
      .replace(/^Error invoking remote method '[^']*':\s*/, '')
      .replace(/^Error:\s*/, '')
      .trim() || '未知错误'
  )
}
