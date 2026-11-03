/**
 * 全局界面时钟。
 *
 * 为什么单独放一个 store，而不是每个组件各起一个 setInterval？
 * 主界面时钟（标题栏）、状态栏的「N 秒前」、图表的实时刷新节奏都需要
 * 「现在几点」；一个 1 秒定时器在根组件启动一次，所有组件共享同一个信号，
 * 既不会出现多个时钟差一秒，也不会在切页时留下孤儿定时器。
 *
 * 注意：这里只做 UI 时间，不承担行情轮询；行情定时器仍在主进程/Python。
 */
import { createSignal } from 'solid-js'
import { shanghaiClock, type ShanghaiClock } from '@shared/market'

const [clockNow, setClockNow] = createSignal(Date.now())
let timer: ReturnType<typeof setInterval> | null = null

/** 在 App 根组件挂载时调用一次；重复调用是幂等的。 */
export function startClock(): void {
  if (timer) return
  setClockNow(Date.now())
  timer = setInterval(() => setClockNow(Date.now()), 1000)
}

export { clockNow }

/** 当前北京时间（每秒更新一次） */
export function currentClock(): ShanghaiClock {
  return shanghaiClock(new Date(clockNow()))
}
