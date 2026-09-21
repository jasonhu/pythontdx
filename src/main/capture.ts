/**
 * 界面截图工具（开发 / 回归验证用）。
 *
 * 用途：改完布局或样式后，需要「真的看一眼」而不是凭感觉说没问题。
 * 用法：`npm run shot` → 构建 → 启动应用 → 等首屏数据到位 → 截图存盘 → 退出。
 *
 * 实现要点：
 *   · 只在设置了 STOCKLENS_CAPTURE 环境变量时才生效，正常启动完全不受影响；
 *   · 必须等页面显示出来再截图，隐藏窗口 capturePage() 会返回空图；
 *   · 延迟默认 4 秒，留给行情请求和 SVG 图表渲染的时间。
 */
import { writeFile } from 'node:fs/promises'
import { app, type BrowserWindow } from 'electron'

export function setupCapture(window: BrowserWindow): void {
  const target = process.env.STOCKLENS_CAPTURE
  if (!target) return

  const delay = Number(process.env.STOCKLENS_CAPTURE_DELAY ?? 4000)

  window.webContents.once('did-finish-load', () => {
    setTimeout(() => {
      void capture(window, target)
    }, delay)
  })
}

async function capture(window: BrowserWindow, target: string): Promise<void> {
  let code = 0
  try {
    const image = await window.webContents.capturePage()
    await writeFile(target, image.toPNG())
    console.log(`[capture] 截图已保存：${target}`)
  } catch (error) {
    console.error('[capture] 截图失败：', error)
    code = 1
  } finally {
    app.exit(code)
  }
}
