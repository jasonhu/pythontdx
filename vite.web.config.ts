import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import solid from 'vite-plugin-solid'

/**
 * Web 端独立构建：复用 src/renderer 与 src/shared，只替换数据入口。
 *
 * 开发：先起 `python3 python/tdx_server.py`，再 `npm run dev:web`。
 * 生产：`npm run build:web`，产物在 out/web。
 */
const root = resolve(__dirname, 'src/web')
const project = resolve(__dirname)

export default defineConfig({
  root,
  plugins: [solid()],
  resolve: {
    alias: {
      '@renderer': resolve(project, 'src/renderer/src'),
      '@shared': resolve(project, 'src/shared')
    }
  },
  server: {
    port: 5174,
    strictPort: true,
    fs: {
      allow: [project]
    }
  },
  build: {
    outDir: resolve(project, 'out/web'),
    emptyOutDir: true
  }
})
