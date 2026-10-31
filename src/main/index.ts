/**
 * 主进程入口。
 *
 * 职责边界（很重要，别让主进程变成第二个业务层）：
 *   主进程 = 窗口生命周期 + 网络访问 + 持久化 + 定时器
 *   渲染进程 = 界面与交互，通过 preload 白名单 API 取数
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow, session } from 'electron'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { IPC } from '@shared/ipc'
import { registerIpcHandlers } from './ipc'
import { QuotePoller } from './services/poller'
import { closeTdx } from './services/tdx'
import { AppStore } from './services/store'
import { createMainWindow } from './window'
import { destroyTray, setupTray } from './tray'

const APP_ID = 'com.stocklens.app'
const APP_NAME = 'StockLens'
const STATE_FILE = 'stocklens.json'
/** 便携版放在 exe 旁边的数据目录名 */
const PORTABLE_DATA_DIR = 'StockLens-data'

let mainWindow: BrowserWindow | null = null
let store: AppStore | undefined
let poller: QuotePoller | undefined
let flushing = false
let quitting = false

/**
 * 便携版（electron-builder 的 portable 目标）会把 exe 所在目录注入到
 * 环境变量 `PORTABLE_EXECUTABLE_DIR`。这时把配置写在 exe 旁边的
 * `StockLens-data/` 里，「拷走 exe + 这个目录」就等于换台电脑继续用，
 * 系统里不留任何痕迹（不写注册表、不碰 %APPDATA%）。
 *
 * 如果目录不可写（放在只读介质、Program Files、网络盘等），
 * 静默退回系统默认目录，而不是让应用起不来。
 */
function resolvePortableUserData(): string | undefined {
  const portableDir = process.env.PORTABLE_EXECUTABLE_DIR
  if (!portableDir) return undefined

  const candidate = join(portableDir, PORTABLE_DATA_DIR)
  try {
    mkdirSync(candidate, { recursive: true })
    // 真正写一次才能确认可写：mkdir 成功但目录只读的情况是存在的
    const probe = join(candidate, '.write-probe')
    writeFileSync(probe, '')
    rmSync(probe)
    return candidate
  } catch {
    console.warn('[main] 便携版数据目录不可写，回退到系统默认目录：', candidate)
    return undefined
  }
}

/**
 * Linux 运行时图形后端（Chromium 当前不允许 Wayland 表面 + Vulkan 同时启用）：
 * - 默认 wayland：原生 Wayland，OpenGL/EGL；最稳；
 * - x11：XWayland/X11 + OpenGL；
 * - vulkan：XWayland/X11 + ANGLE Vulkan（需要真实 Vulkan 驱动）；
 * 可用 STOCKLENS_GRAPHICS=wayland|x11|vulkan 覆盖。
 */
function requestedGraphicsMode(): 'wayland' | 'x11' | 'vulkan' {
  const requested = (process.env.STOCKLENS_GRAPHICS ?? 'wayland').toLowerCase()
  return requested === 'x11' || requested === 'vulkan' ? requested : 'wayland'
}

function configureLinuxGraphics(): void {
  if (process.platform !== 'linux') return
  const mode = requestedGraphicsMode()
  if (mode === 'wayland') {
    app.commandLine.appendSwitch('ozone-platform-hint', 'auto')
    app.commandLine.appendSwitch('enable-features', 'WaylandWindowDecorations')
    app.commandLine.appendSwitch('enable-wayland-ime')
  } else {
    app.commandLine.appendSwitch('ozone-platform', 'x11')
    if (mode === 'vulkan') {
      app.commandLine.appendSwitch('use-angle', 'vulkan')
      app.commandLine.appendSwitch('enable-features', 'Vulkan')
    }
  }
  console.log(
    `[runtime] platform=linux session=${process.env.XDG_SESSION_TYPE ?? 'unknown'} ` +
      `wayland=${process.env.WAYLAND_DISPLAY ?? '-'} graphics=${mode}`
  )
}

/**
 * 请求 Vulkan 但驱动/Chromium 报告不可用时，明确回退到 Wayland 并重启一次。
 * 用环境变量防循环；正常 Wayland 默认路径不会进入这里。
 */
function fallbackVulkanIfUnavailable(): boolean {
  if (
    process.platform !== 'linux' ||
    requestedGraphicsMode() !== 'vulkan' ||
    process.env.STOCKLENS_GPU_FALLBACK === '1'
  ) {
    return false
  }
  const vulkan =
    (app.getGPUFeatureStatus() as unknown as Record<string, string>).vulkan ?? 'unknown'
  if (!vulkan.startsWith('disabled')) return false

  console.warn(`[runtime] Vulkan unavailable (${vulkan}); fallback to wayland and relaunch once`)
  process.env.STOCKLENS_GRAPHICS = 'wayland'
  process.env.STOCKLENS_GPU_FALLBACK = '1'
  app.relaunch({ args: process.argv.slice(1) })
  app.exit(0)
  return true
}

configureLinuxGraphics()

/* ----------------------------------------------------------- 单实例锁 */
// 第二次启动时不再开新窗口，而是把已有窗口拉到前面（行情软件的标准行为）
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  bootstrap()
}

function bootstrap(): void {
  // 必须在读取 userData 路径之前改名，否则开发环境和打包后的数据目录会不一致
  app.setName(APP_NAME)

  // 便携版优先：把数据放在 exe 旁边（必须在 ready 之前设置）
  const portableUserData = resolvePortableUserData()
  if (portableUserData) app.setPath('userData', portableUserData)

  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin' && !store?.state.settings.closeToTray) app.quit()
  })

  // 退出前把内存里的状态落盘（写入是异步的，所以要先拦一下退出流程）
  app.on('before-quit', (event) => {
    quitting = true
    destroyTray()
    if (flushing || !store) return
    flushing = true
    event.preventDefault()
    poller?.stop()
    closeTdx()
    void store.flush().finally(() => app.quit())
  })

  app.whenReady().then(onReady).catch(console.error)
}

function onReady(): void {
  electronApp.setAppUserModelId(APP_ID)
  console.log(`[runtime] gpu-feature-status ${JSON.stringify(app.getGPUFeatureStatus())}`)
  if (fallbackVulkanIfUnavailable()) return

  // 数据导出走浏览器下载；显式落到系统下载目录，避免 Electron 默认行为随版本漂移。
  session.defaultSession.on('will-download', (_event, item) => {
    const target = join(app.getPath('downloads'), item.getFilename())
    item.setSavePath(target)
    console.log(`[download] ${target}`)
  })

  // 开发模式下放开 F12 / Ctrl+R 之类的快捷键
  app.on('browser-window-created', (_event, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  store = new AppStore(join(app.getPath('userData'), STATE_FILE))
  store.load()

  const currentStore = store

  poller = new QuotePoller({
    emit: (update) => {
      // 多窗口：每扇窗都订阅了同一份行情流，不能只推主窗口。
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) window.webContents.send(IPC.quoteUpdate, update)
      }
    },
    // 窗口不可见时跳过拉取，省流量也省上游压力（可在设置里关掉）
    canFetch: () => {
      if (!currentStore.state.settings.pauseWhenHidden) return true
      if (!mainWindow || mainWindow.isDestroyed()) return false
      return mainWindow.isVisible() && !mainWindow.isMinimized()
    }
  })

  registerIpcHandlers({
    store: currentStore,
    poller,
    getWindow: () => mainWindow
  })

  mainWindow = createMainWindow({
    bounds: currentStore.bounds,
    onBoundsChange: (bounds) => currentStore.saveBounds(bounds),
    // 截图工具用 app.exit() 退出，绕过 before-quit，所以得自己把状态落盘
    flushState: () => currentStore.flush()
  })

  mainWindow.on('close', (event) => {
    if (!quitting && currentStore.state.settings.closeToTray !== false) {
      event.preventDefault()
      console.log('[tray] 关闭窗口 -> 隐藏到托盘')
      mainWindow?.hide()
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
    poller?.stop()
  })

  setupTray(mainWindow)

  // macOS 点 Dock 图标时重新开窗
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length > 0) return
    mainWindow = createMainWindow({
      bounds: currentStore.bounds,
      onBoundsChange: (bounds) => currentStore.saveBounds(bounds),
      flushState: () => currentStore.flush()
    })
  })

  if (is.dev) {
    console.log(`[main] 配置文件：${join(app.getPath('userData'), STATE_FILE)}`)
  }
}

/* ------------------------------------------------------------ 兜底日志 */
// 主进程里的异常如果没人接住，Electron 会直接崩掉且不给任何提示，这里至少留个记录
process.on('uncaughtException', (error) => {
  console.error('[main] 未捕获异常：', error)
})

process.on('unhandledRejection', (reason) => {
  console.error('[main] 未处理的 Promise 拒绝：', reason)
})
