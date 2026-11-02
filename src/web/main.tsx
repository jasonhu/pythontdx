import { createHttpApi } from './http-api'
import { migrateLegacyLocalStorage } from '../renderer/src/lib/legacy-storage'

// 先迁移旧 key，再创建 Web 状态客户端（它会读取 pythontdx:web:state）。
migrateLegacyLocalStorage()

// 先装好 window.api，再加载共享渲染层：lib/ipc.ts 在模块顶层读取 window.api
window.api = createHttpApi()
await import('../renderer/src/main')
