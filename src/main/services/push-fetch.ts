/** 面板级推送的任务分派；与调度分开，方便单测用假 fetcher。 */
import type { PushTask } from '@shared/types'
import {
  fetchAuctions,
  fetchCategoryQuotes,
  fetchFiveDayTrend,
  fetchKline,
  fetchMacMoneyFlow,
  fetchMinuteTrend,
  fetchMoneyFlow,
  fetchTrades
} from './tdx'

export async function fetchPushTask(task: PushTask): Promise<unknown> {
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
    case 'kline':
      return fetchKline(task.code, task.period, task.count, task.adjust)
    case 'minute':
      return fetchMinuteTrend(task.code)
    case 'fiveDay':
      return fetchFiveDayTrend(task.code)
  }
}
