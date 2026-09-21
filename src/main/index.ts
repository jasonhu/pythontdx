/**
 * 主进程入口。
 *
 * 职责边界（很重要，别让主进程变成第二个业务层）：
 *   主进程 = 窗口生命周期 + 网络访问 + 持久化 + 定时器
 *   渲染进程 = 界面与交互，通过 preload 白名单 API 取数
 */
import { join } from 'node:path'
import { app, BrowserWindow } from 'electron'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { IPC } from '@shared/ipc'
import { registerIpcHandlers } from './ipc'
import { QuotePoller } from './services/poller'
import { AppStore } from './services/store'
import { createMainWindow } from './window'

const APP_ID = 'com.stocklens.app'
const APP_NAME = 'StockLens'
const STATE_FILE = 'stocklens.json'

let mainWindow: BrowserWindow | null = null
let store: AppStore | undefined
let poller: QuotePoller | undefined
let flushing = false

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

  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  // 退出前把内存里的状态落盘（写入是异步的，所以要先拦一下退出流程）
  app.on('before-quit', (event) => {
    if (flushing || !store) return
    flushing = true
    event.preventDefault()
    poller?.stop()
    void store.flush().finally(() => app.quit())
  })

  app.whenReady().then(onReady).catch(console.error)
}

function onReady(): void {
  electronApp.setAppUserModelId(APP_ID)

  // 开发模式下放开 F12 / Ctrl+R 之类的快捷键
  app.on('browser-window-created', (_event, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  store = new AppStore(join(app.getPath('userData'), STATE_FILE))
  store.load()

  const currentStore = store

  poller = new QuotePoller({
    emit: (update) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(IPC.quoteUpdate, update)
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
    onBoundsChange: (bounds) => currentStore.saveBounds(bounds)
  })

  mainWindow.on('closed', () => {
    mainWindow = null
    poller?.stop()
  })

  // macOS 点 Dock 图标时重新开窗
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length > 0) return
    mainWindow = createMainWindow({
      bounds: currentStore.bounds,
      onBoundsChange: (bounds) => currentStore.saveBounds(bounds)
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
