/**
 * 无边框窗口的创建与几何状态管理。
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { BrowserWindow, shell } from 'electron'
import { is } from '@electron-toolkit/utils'
import type { WindowBounds } from './services/store'

const DEFAULT_WIDTH = 1280
const DEFAULT_HEIGHT = 820
const MIN_WIDTH = 1024
const MIN_HEIGHT = 660

/** 深色底：与渲染层 --bg-base 保持一致，避免启动瞬间白屏闪烁 */
const BACKGROUND_COLOR = '#0a0c12'

/**
 * 开发期给任务栏/Alt-Tab 一个像样的图标；
 * 打包后图标由 electron-builder 写进可执行文件，这里返回 undefined 即可。
 */
function resolveWindowIcon(): string | undefined {
  const candidates =
    process.platform === 'win32'
      ? [join(__dirname, '../../build/icon.ico'), join(__dirname, '../../resources/icon.png')]
      : [join(__dirname, '../../resources/icon.png')]

  return candidates.find((file) => existsSync(file))
}

export interface CreateWindowOptions {
  bounds?: WindowBounds
  onBoundsChange?: (bounds: WindowBounds) => void
}

export function createMainWindow(options: CreateWindowOptions = {}): BrowserWindow {
  const icon = resolveWindowIcon()

  const window = new BrowserWindow({
    width: options.bounds?.width ?? DEFAULT_WIDTH,
    height: options.bounds?.height ?? DEFAULT_HEIGHT,
    x: options.bounds?.x,
    y: options.bounds?.y,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    show: false,
    // 自绘标题栏：Windows/Linux 完全去边框，macOS 保留原生红绿灯
    frame: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    trafficLightPosition: { x: 18, y: 16 },
    backgroundColor: BACKGROUND_COLOR,
    autoHideMenuBar: true,
    ...(icon ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // 渲染层保持隔离与沙箱，只通过 preload 暴露的白名单 API 通信
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
      // 行情页不需要背景节流，避免最小化恢复后图表卡顿
      backgroundThrottling: false
    }
  })

  // 先隐藏渲染，等首屏画完再显示，杜绝白屏
  window.on('ready-to-show', () => window.show())

  // 外部链接交给系统浏览器，不在 App 内开新窗口
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  attachDiagnostics(window)

  const reportBounds = debounce(() => {
    if (!window.isMaximized() && !window.isMinimized() && !window.isFullScreen()) {
      options.onBoundsChange?.(window.getNormalBounds())
    }
  }, 400)

  window.on('resize', reportBounds)
  window.on('move', reportBounds)

  // 最大化状态变化要通知渲染层，好切换标题栏按钮的图标
  const notifyState = (): void => {
    window.webContents.send('window:state', {
      maximized: window.isMaximized(),
      focused: window.isFocused(),
      platform: process.platform
    })
  }
  window.on('maximize', notifyState)
  window.on('unmaximize', notifyState)
  window.on('focus', notifyState)
  window.on('blur', notifyState)

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void window.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return window
}

function debounce<T extends (...args: never[]) => void>(fn: T, delay: number): T {
  let timer: NodeJS.Timeout | null = null
  return ((...args: Parameters<T>) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => fn(...args), delay)
  }) as T
}

/**
 * 开发期诊断：把渲染进程里发生的事搬到终端里来。
 *
 * 新手最容易踩的坑是「界面白屏但终端一片安静」——
 * 渲染层的报错默认只出现在 DevTools 里，很容易被忽略。
 */
function attachDiagnostics(window: BrowserWindow): void {
  const { webContents } = window

  webContents.on('render-process-gone', (_event, details) => {
    console.error('[renderer] 渲染进程异常退出：', details.reason, details.exitCode)
  })

  webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error(`[renderer] 页面加载失败：${errorDescription} (${errorCode}) ${validatedURL}`)
  })

  if (!is.dev) return

  // Solid 的报错、未捕获异常都会走这里
  webContents.on('console-message', (details) => {
    const tag = `[renderer:${details.level}]`
    const location = details.sourceId ? ` (${details.sourceId}:${details.lineNumber})` : ''
    if (details.level === 'error') console.error(`${tag} ${details.message}${location}`)
    else if (details.level === 'warning') console.warn(`${tag} ${details.message}${location}`)
    else console.log(`${tag} ${details.message}`)
  })
}
