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

/** 测量线涨跌幅；起点价格非正/无效返回 null，避免显示 Infinity。 */
export function measurementPercent(startPrice: number, endPrice: number): number | null {
  if (!Number.isFinite(startPrice) || !Number.isFinite(endPrice) || startPrice <= 0) return null
  return ((endPrice - startPrice) / startPrice) * 100
}

/** 测量线跨过的 K 线根数（端点在同一根为 0）。 */
export function measurementBars(startIndex: number, endIndex: number): number {
  if (!Number.isFinite(startIndex) || !Number.isFinite(endIndex)) return 0
  return Math.abs(Math.round(endIndex) - Math.round(startIndex))
}

export interface ArrowPoint {
  x: number
  y: number
}

/**
 * 箭头头部的三个点：终点 + 两侧回折。
 * 用屏幕坐标计算，线宽/方向变化时箭头始终指向终点。
 */
export function arrowHeadPoints(
  start: ArrowPoint,
  end: ArrowPoint,
  size = 9
): [ArrowPoint, ArrowPoint, ArrowPoint] | [] {
  const values = [start.x, start.y, end.x, end.y]
  if (values.some((value) => !Number.isFinite(value)) || size <= 0) return []
  const angle = Math.atan2(end.y - start.y, end.x - start.x)
  const spread = 0.45
  return [
    end,
    {
      x: end.x - size * Math.cos(angle - spread),
      y: end.y - size * Math.sin(angle - spread)
    },
    {
      x: end.x - size * Math.cos(angle + spread),
      y: end.y - size * Math.sin(angle + spread)
    }
  ]
}

/** 平行通道的垂直偏移：第三点价格减终点价格。 */
export function channelOffset(endPrice: number, thirdPrice: number): number | null {
  if (!Number.isFinite(endPrice) || !Number.isFinite(thirdPrice)) return null
  return thirdPrice - endPrice
}
