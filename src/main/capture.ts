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
 *   STOCKLENS_CAPTURE_POINTER 真实指针操作：`move@选择器@比例` / `click@选择器@比例`
 *   STOCKLENS_CAPTURE_WHEEL   真实滚轮：`deltaY@选择器@比例`（如 -100@.chart-host@0.25）
 *   STOCKLENS_CAPTURE_PROBE   等它出现并回读它的文本，打印到终端
 *   STOCKLENS_CAPTURE_EVAL    截图前求值一个只读表达式并打印（量尺寸用，别写有副作用的代码）
 *
 * 最后一个开关是给**自动化验证**用的：截图是给眼睛看的，但程序断言需要文本；
 * 顺带它还是「等界面就绪」的信号 —— 切完 tab 数据是异步来的，不等就会和加载抢时间。
 */
import { writeFile } from 'node:fs/promises'
import { app, type BrowserWindow } from 'electron'

export function setupCapture(window: BrowserWindow, flushState?: () => Promise<void>): void {
  const target = process.env.STOCKLENS_CAPTURE
  if (!target) return

  const delay = Number(process.env.STOCKLENS_CAPTURE_DELAY ?? 4000)

  window.webContents.once('did-finish-load', () => {
    setTimeout(() => {
      void capture(window, target, flushState)
    }, delay)
  })
}

async function capture(
  window: BrowserWindow,
  target: string,
  flushState?: () => Promise<void>
): Promise<void> {
  let code = 0
  try {
    await drive(window)
    // 让最后一次异步渲染真正上屏；capturePage 可能拿到上一帧，
    // 板块/数据弹窗刚加载完就截图时尤其明显。
    await wait(350)
    const image = await window.webContents.capturePage()
    await writeFile(target, image.toPNG())
    console.log(`[capture] 截图已保存：${target}`)
  } catch (error) {
    console.error('[capture] 截图失败：', error)
    code = 1
  } finally {
    // app.exit() 不走 before-quit，内存里还没落盘的设置会直接丢 ——
    // 「点完档位马上退出」就丢过一次（写入有 150ms 防抖）。所以自己先落盘再退。
    if (flushState) {
      try {
        await flushState()
      } catch (error) {
        console.error('[capture] 退出前落盘失败：', error)
      }
    }
    const hold = Number(process.env.STOCKLENS_CAPTURE_HOLD_MS ?? 0)
    if (Number.isFinite(hold) && hold > 0) await wait(hold)
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

  /**
   * 真实指针：`move@<选择器>@<横向比例>` / `click@<选择器>@<横向比例>`，逗号分隔。
   *
   * 为什么不能只用上面的 `CLICK`？因为它走的是 `element.click()` ——
   * **程序化点击不会移动焦点**（焦点是 mousedown 的默认行为，`click()` 没有这一步）。
   * 于是「点了 tab 之后焦点留在那个按钮上，鼠标移到图上按 ↑ 什么也不发生」
   * 这类问题，只有真实鼠标事件才复现得出来（`docs/06` 第 26 条）。
   */
  for (const spec of split(process.env.STOCKLENS_CAPTURE_POINTER)) {
    const [action, selector, rawRatio] = spec.split('@')
    if ((action !== 'move' && action !== 'click') || !selector) {
      console.warn(`[capture] 指针参数看不懂，跳过：${spec}（正确写法 click@.chart-host@0.5）`)
      continue
    }
    const ratio = Number.isFinite(Number(rawRatio)) ? Number(rawRatio) : 0.5
    const point = await pointOf(window, selector, ratio)
    if (!point) {
      console.warn(`[capture] 找不到指针目标元素：${selector}`)
      continue
    }
    // 先移动再按下：真实鼠标永远是这个顺序，而且 Chromium 靠 mouseMove 触发 pointerenter
    window.webContents.sendInputEvent({ type: 'mouseMove', x: point.x, y: point.y })
    await wait(60)
    if (action === 'click') {
      window.webContents.sendInputEvent({
        type: 'mouseDown',
        x: point.x,
        y: point.y,
        button: 'left',
        clickCount: 1
      })
      await wait(30)
      window.webContents.sendInputEvent({
        type: 'mouseUp',
        x: point.x,
        y: point.y,
        button: 'left',
        clickCount: 1
      })
    }
    await wait(300)
  }

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

  // 滚轮：`<deltaY>@<选择器>@<横向比例>`，比例可省（默认元素正中间）。
  // 为什么要注入滚轮而不是只单测那个累加器？因为有两件事只有真跑一遍才知道：
  // 「非 passive 监听有没有生效」和「Electron 的 deltaY 单位是不是 DOM 的那一套」。
  const wheelSpecs = split(process.env.STOCKLENS_CAPTURE_WHEEL)
  if (wheelSpecs.length > 0) {
    // 先装一个记录器：只看「界面没反应」分不清是「事件没送到」还是「deltaY 太小」，
    // 把渲染层**实际收到**的 deltaY 读回来，一次就能判定。
    await evaluate(
      window,
      `window.__captureWheelDeltas = [];
       window.addEventListener('wheel',
         (event) => window.__captureWheelDeltas.push(event.deltaY),
         { capture: true, passive: true })`
    )
  }

  /**
   * Electron 注入的 deltaY 与渲染层收到的**不是同一套单位**。本机（Windows，2x DPI）实测：
   *   注入 `deltaY: -100` → 渲染层收到 `+50`
   * 即「符号相反、数值除以 devicePixelRatio」。不换算的话，环境变量里写 -100
   * 只会在 DOM 里变成 50，连一格都凑不满，看起来就像滚轮完全没反应。
   */
  const pixelRatio = Number(await evaluate(window, 'window.devicePixelRatio')) || 1

  for (const spec of wheelSpecs) {
    const [rawDelta, selector, rawRatio] = spec.split('@')
    const deltaY = Number(rawDelta)
    if (!Number.isFinite(deltaY) || deltaY === 0 || !selector) {
      console.warn(`[capture] 滚轮参数看不懂，跳过：${spec}（正确写法 -100@.chart-host@0.25）`)
      continue
    }

    const ratio = Number.isFinite(Number(rawRatio)) ? Number(rawRatio) : 0.5
    const point = await pointOf(window, selector, ratio)
    if (!point) {
      console.warn(`[capture] 找不到滚轮目标元素：${selector}`)
      continue
    }

    // hasPreciseScrollingDeltas 让 deltaY 按「像素」解释，而不是按「格数」再乘系数；
    // 代价是它按**设备像素**算，所以要乘回 pixelRatio（见上面的实测换算）
    window.webContents.sendInputEvent({
      type: 'mouseWheel',
      x: point.x,
      y: point.y,
      deltaY: -deltaY * pixelRatio,
      canScroll: false,
      hasPreciseScrollingDeltas: true
    })
    await wait(120)
  }

  if (wheelSpecs.length > 0) {
    // 自检：把渲染层**实际收到**的 deltaY 读回来跟请求的比。
    // 单位或符号哪天变了（Electron 升级、换平台），这里会直接说出来，
    // 而不是让下一个调试的人再去猜「为什么滚轮没反应」。
    const observed = await evaluate(window, `(window.__captureWheelDeltas ?? []).join(',')`)
    const requested = wheelSpecs
      .map((spec) => Number(spec.split('@')[0]))
      .filter((value) => Number.isFinite(value) && value !== 0)
    console.log(`[capture] 滚轮：请求 DOM deltaY = [${requested.join(', ')}] → 实收 [${observed}]`)
    if (observed !== requested.join(',')) {
      console.warn('[capture] 滚轮换算与实测不一致 —— 注入 deltaY 的单位或符号可能变了')
    }
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
    console.log(
      `[capture] eval ${measure} → ${await evaluate(window, `Promise.resolve(${measure})`)}`
    )
  }
}

/** 选择器 + 横向比例 → 页面坐标（CSS 像素，也就是 Electron 要的 DIP）；找不到元素返回 undefined */
async function pointOf(
  window: BrowserWindow,
  selector: string,
  ratio: number
): Promise<{ x: number; y: number } | undefined> {
  const point = await evaluate(
    window,
    `(() => {
       const el = document.querySelector(${json(selector)})
       if (!el) return ''
       const rect = el.getBoundingClientRect()
       return Math.round(rect.left + rect.width * ${ratio}) + ',' +
              Math.round(rect.top + rect.height / 2)
     })()`
  )
  // 先挡空串：''.split(',') 会得到 ['']，而 Number('') === 0，会被误当成合法坐标 (0, 0)
  if (!point) return undefined
  const [x, y] = point.split(',').map(Number)
  if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined
  return { x, y }
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
