/**
 * 斐波那契回撤的纯计算。
 *
 * 画线工具只记两个端点（起点/终点价格），渲染时按固定比例插值；
 * 不依赖图表几何，方便单元测试。
 */
export const FIB_RATIOS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1] as const
export const FIB_EXTENSION_RATIOS = [1.272, 1.618] as const

export interface FibLevel {
  ratio: number
  price: number
}

export function fibonacciLevels(
  startPrice: number,
  endPrice: number,
  extended = false
): FibLevel[] {
  if (!Number.isFinite(startPrice) || !Number.isFinite(endPrice)) return []
  const ratios = extended ? [...FIB_RATIOS, ...FIB_EXTENSION_RATIOS] : FIB_RATIOS
  return ratios.map((ratio) => ({
    ratio,
    price: startPrice + (endPrice - startPrice) * ratio
  }))
}
