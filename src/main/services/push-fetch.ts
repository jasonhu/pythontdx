/** 面板级推送的任务分派；与调度分开，方便单测用假 fetcher。 */
import type { PushTask } from '@shared/types'
import {
  fetchAuctions,
  fetchCategoryQuotes,
  fetchFiveDayTrend,
  fetchKlineLive,
  fetchMacMoneyFlow,
  fetchMinuteTrend,
  fetchMoneyFlow,
  fetchTrades
} from './tdx'

export async function fetchPushTask(task: PushTask, first = false): Promise<unknown> {
  switch (task.kind) {
    case 'category':
      return fetchCategoryQuotes({
        category: task.category,
        sortType: task.sortType,
        start: task.start,
        count: task.count,
        ascending: task.ascending
      })
    case 'ticks':
      return fetchTrades({
        code: task.code,
        date: task.date,
        start: task.start,
        count: task.count
      })
    case 'auction':
      return fetchAuctions(task.code, task.date)
    case 'moneyFlow': {
      const [flow, mac] = await Promise.all([
        fetchMoneyFlow(task.code),
        fetchMacMoneyFlow(task.code)
      ])
      return { flow, mac }
    }
    // 面板订阅是「实时推送」，必须绕过主进程 TTL 缓存；否则 10s/60s
    // 缓存会把 1s 一推变成 1s 一读旧值，用户看到的就是「不刷新」。
    // 首帧给全量，之后每秒只回最近 20 根，渲染层合并；否则 9 张图
    // 每秒各传 800 根会把 IPC/HTTP 打满。
    case 'kline':
      return fetchKlineLive(task.code, task.period, task.count, task.adjust, first)
    case 'minute':
      return fetchMinuteTrend(task.code, undefined, true)
    case 'fiveDay':
      return fetchFiveDayTrend(task.code, undefined, true)
  }
}
