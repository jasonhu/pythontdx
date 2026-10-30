import { createHttpApi } from './http-api'

// 先装好 window.api，再加载共享渲染层：lib/ipc.ts 在模块顶层读取 window.api
window.api = createHttpApi()
await import('../renderer/src/main')
