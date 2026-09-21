import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import solid from 'vite-plugin-solid'

/**
 * electron-vite 把三个「入口世界」分开构建：
 *   main     → Node 环境，产物 out/main/index.js（CommonJS）
 *   preload  → 沙箱桥接层，产物 out/preload/index.js
 *   renderer → 浏览器环境，产物 out/renderer/*
 *
 * 三个世界共享同一份类型定义（src/shared），靠 alias 打通。
 */
const shared = resolve(__dirname, 'src/shared')

export default defineConfig({
  main: {
    // 把 dependencies 里的包标记为 external，交给 Node 运行时 require，
    // 这样主进程代码不会被无谓地打进 bundle。
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: { '@shared': shared }
    },
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: { '@shared': shared }
    },
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') }
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve(__dirname, 'src/renderer/src'),
        '@shared': shared
      }
    },
    plugins: [solid()],
    build: {
      // 渲染层不需要 sourcemap 进生产包，但保留 chunk 体积警告阈值
      chunkSizeWarningLimit: 1200
    }
  }
})
