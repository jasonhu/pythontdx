/**
 * 全市场涨跌分布：13 个固定档位，纯函数，桌面/Web/测试共用。
 *
 * 分档规则：≤-10、(-10,-7]、…、(-1,0)、0、(0,1]、…、(7,10]、>10。
 * 非有限值（停牌/缺字段）不计数。
 */

export type DistributionTone = 'up' | 'down' | 'flat'

export interface ChangeBucket {
  label: string
  tone: DistributionTone
  count: number
}

const BUCKETS: Array<Omit<ChangeBucket, 'count'>> = [
  { label: '≤-10', tone: 'down' },
  { label: '-10~-7', tone: 'down' },
  { label: '-7~-5', tone: 'down' },
  { label: '-5~-3', tone: 'down' },
  { label: '-3~-1', tone: 'down' },
  { label: '-1~0', tone: 'down' },
  { label: '0', tone: 'flat' },
  { label: '0~1', tone: 'up' },
  { label: '1~3', tone: 'up' },
  { label: '3~5', tone: 'up' },
  { label: '5~7', tone: 'up' },
  { label: '7~10', tone: 'up' },
  { label: '≥10', tone: 'up' }
]

function bucketIndex(value: number): number {
  if (value === 0) return 6
  if (value <= -10) return 0
  if (value <= -7) return 1
  if (value <= -5) return 2
  if (value <= -3) return 3
  if (value <= -1) return 4
  if (value < 0) return 5
  if (value <= 1) return 7
  if (value <= 3) return 8
  if (value <= 5) return 9
  if (value <= 7) return 10
  if (value <= 10) return 11
  return 12
}

export function buildChangeDistribution(values: readonly number[]): ChangeBucket[] {
  const counts = new Array<number>(BUCKETS.length).fill(0)
  for (const value of values) {
    if (!Number.isFinite(value)) continue
    counts[bucketIndex(value)] += 1
  }
  return BUCKETS.map((bucket, index) => ({ ...bucket, count: counts[index] }))
}
