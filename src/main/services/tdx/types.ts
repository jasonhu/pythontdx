/** 通达信代码表的一条记录（Python 桥接进程原样返回） */
import type { Market } from '@shared/types'

export interface SecurityInfo {
  /** 带市场前缀的标准代码，如 sh600519 */
  code: string
  market: Market
  symbol: string
  name: string
  /** 小数位，来自 0x044d 代码表 */
  decimal: number
  /** 证券类型，用于搜索结果的标签 */
  kind: string
}
