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
 *
 * 键盘交互（比如 K 线的上下键缩放）**没法用一张静态截图验证** ——
 * 必须真的把按键送进去，才看得到按下之后界面变成了什么样。所以额外有三个开关：
 *
 *   STOCKLENS_CAPTURE_CLICK   截图前依次点击的选择器，逗号分隔（切 tab 这类操作）
 *   STOCKLENS_CAPTURE_FOCUS   点击并等界面就绪之后，把焦点放到这个选择器上
 *   STOCKLENS_CAPTURE_KEYS    截图前依次发送的按键，逗号分隔，用 Electron 的键名（如 Up,Up）
 *   STOCKLENS_CAPTURE_PROBE   等它出现并回读它的文本，打印到终端
 *   STOCKLENS_CAPTURE_EVAL    截图前求值一个只读表达式并打印（量尺寸用，别写有副作用的代码）
 *
 * 最后一个开关是给**自动化验证**用的：截图是给眼睛看的，但程序断言需要文本；
 * 顺带它还是「等界面就绪」的信号 —— 切完 tab 数据是异步来的，不等就会和加载抢时间。
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
    await drive(window)
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

/** 按需把界面点到想验证的状态、送按键、回读文本；环境变量都没配时什么都不做 */
async function drive(window: BrowserWindow): Promise<void> {
  // 顺序刻意和人的操作一致：点 tab → 等界面就绪 → 点住图表 → 按上下键。
  // 焦点必须放在**等就绪之后**：切 tab 会重建图表 DOM，提前聚焦的话，
  // 等数据回来时那个元素已经被换掉了，按键就没有落点。
  for (const selector of split(process.env.STOCKLENS_CAPTURE_CLICK)) {
    await evaluate(window, `document.querySelector(${json(selector)})?.click()`)
    await wait(120)
  }

  const probe = process.env.STOCKLENS_CAPTURE_PROBE
  if (probe) await waitFor(window, probe, 8000)

  const focus = process.env.STOCKLENS_CAPTURE_FOCUS
  if (focus) {
    await evaluate(window, `document.querySelector(${json(focus)})?.focus()`)
    await wait(120)
  }

  for (const key of split(process.env.STOCKLENS_CAPTURE_KEYS)) {
    const keyCode = acceleratorName(key)
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode })
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode })
    // 留一帧给 Solid 重渲染，否则截到的还是按键之前的样子
    await wait(120)
  }

  if (probe) {
    const text = await evaluate(
      window,
      `document.querySelector(${json(probe)})?.textContent ?? '（未找到）'`
    )
    console.log(`[capture] ${probe} → ${text}`)
  }

  // 只读表达式：布局有没有溢出、蜡烛实际画了多宽，这类问题没有文字可读，
  // 只能自己算出来。人眼能看出来的东西，这里尽量也能量出来。
  const measure = process.env.STOCKLENS_CAPTURE_EVAL
  if (measure) {
    console.log(`[capture] eval ${measure} → ${await evaluate(window, `String(${measure})`)}`)
  }
}

/** 轮询等待选择器出现；超时不算失败，继续截图（说不定「没出现」本身就是结论） */
async function waitFor(window: BrowserWindow, selector: string, timeout: number): Promise<void> {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const found = await evaluate(window, `document.querySelector(${json(selector)}) ? '1' : ''`)
    if (found === '1') return
    await wait(150)
  }
  console.warn(`[capture] 等待 ${selector} 超时（${timeout}ms），仍继续截图`)
}

/** 逗号分隔的环境变量 → 去空白的数组 */
function split(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

/**
 * DOM 风格键名 → Electron 加速器键名。
 *
 * 为什么需要？`sendInputEvent({ keyCode })` 收的是**加速器键名**（`Up` / `Left`），
 * 传 DOM 的 `ArrowUp` 不会报错，只是按键**一点反应都没有** —— 最难查的那种失败
 *（本项目的第 24 条踩坑就是这么来的）。干脆两种写法都收下，省得下次再踩。
 */
const KEY_ALIASES: Record<string, string> = {
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Escape: 'Esc',
  Enter: 'Return'
}

function acceleratorName(key: string): string {
  return KEY_ALIASES[key] ?? key
}

/** 在页面里求值；只把结果当字符串用，避免 any 扩散 */
async function evaluate(window: BrowserWindow, script: string): Promise<string> {
  const result: unknown = await window.webContents.executeJavaScript(script)
  return typeof result === 'string' ? result : String(result ?? '')
}

function json(value: string): string {
  return JSON.stringify(value)
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}