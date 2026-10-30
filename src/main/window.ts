/**
 * 无边框窗口的创建与几何状态管理。
 */
import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { BrowserWindow, shell } from 'electron'
import { is } from '@electron-toolkit/utils'
import { setupCapture } from './capture'
import { attachDiagnostics } from './diagnostics'
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
  /**
   * 退出前把内存里的状态落盘。
   * 截图工具走的是 `app.exit()`，它会跳过 `before-quit`，
   * 「点完档位马上退出」那次就因此丢过设置（见 capture.ts）。
   */
  flushState?: () => Promise<void>
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
  setupCapture(window, options.flushState)

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

const chartWindows = new Set<BrowserWindow>()

/** 独立 K 线窗口：同一套 preload/渲染层，只渲染 DetachedChart。 */
export function createChartWindow(code: string): BrowserWindow {
  const icon = resolveWindowIcon()
  const child = new BrowserWindow({
    width: 980,
    height: 700,
    minWidth: 760,
    minHeight: 480,
    title: `StockLens · ${code.toUpperCase()}`,
    backgroundColor: BACKGROUND_COLOR,
    autoHideMenuBar: true,
    ...(icon ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
      backgroundThrottling: false
    }
  })
  chartWindows.add(child)
  child.on('closed', () => chartWindows.delete(child))
  child.once('ready-to-show', () => child.show())

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    const url = new URL(process.env['ELECTRON_RENDERER_URL'])
    url.searchParams.set('detached', 'chart')
    url.searchParams.set('code', code)
    void child.loadURL(url.toString())
  } else {
    void child.loadFile(join(__dirname, '../renderer/index.html'), {
      query: { detached: 'chart', code }
    })
  }

  const capturePath = process.env.STOCKLENS_CAPTURE_CHILD
  if (capturePath) {
    child.webContents.once('did-finish-load', () => {
      setTimeout(() => {
        void child.webContents
          .capturePage()
          .then((image) => writeFile(capturePath, image.toPNG()))
          .then(() => console.log(`[capture] 独立窗口截图：${capturePath}`))
          .catch((error) => console.error('[capture] 独立窗口截图失败', error))
      }, 5000)
    })
  }
  return child
}

function debounce<T extends (...args: never[]) => void>(fn: T, delay: number): T {
  let timer: NodeJS.Timeout | null = null
  return ((...args: Parameters<T>) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => fn(...args), delay)
  }) as T
}
