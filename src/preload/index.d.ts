/**
 * 让渲染进程的 TypeScript 知道 window.api 长什么样。
 *
 * 这个文件同时被 tsconfig.node.json（preload 侧）和 tsconfig.web.json（渲染侧）包含，
 * 所以类型定义只有这一份，主进程改了契约，两边会同时报错——这就是我们想要的。
 */
import type { StockLensApi } from '@shared/ipc'

declare global {
  interface Window {
    api: StockLensApi
  }
}

export {}
