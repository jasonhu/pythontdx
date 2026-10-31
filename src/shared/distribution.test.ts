import { describe, expect, it } from 'vitest'
import { buildChangeDistribution } from './distribution'

describe('buildChangeDistribution', () => {
  it('按 13 档归类并排除非有限值', () => {
    const values = [-20, -10, -9.99, -7, -5, -3, -1, -0.01, 0, 0.01, 1, 3, 5, 7, 10, 20, NaN]
    const buckets = buildChangeDistribution(values)
    expect(buckets).toHaveLength(13)
    expect(buckets.map((bucket) => bucket.count)).toEqual([2, 2, 1, 1, 1, 1, 1, 2, 1, 1, 1, 1, 1])
    expect(buckets.reduce((sum, bucket) => sum + bucket.count, 0)).toBe(16)
  })

  it('平盘只计入 0 档', () => {
    const buckets = buildChangeDistribution([0, 0, 0.0001, -0.0001])
    expect(buckets[6].count).toBe(2)
    expect(buckets[5].count).toBe(1)
    expect(buckets[7].count).toBe(1)
  })
})
