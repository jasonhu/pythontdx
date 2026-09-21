import { describe, expect, it } from 'vitest'
import type { KLineBar, MinuteTrend } from '@shared/types'
import {
  DAY_SLOTS,
  KLINE_PADDING,
  TREND_PADDING,
  buildKLineGeometry,
  buildKLineLevels,
  buildKLineTicks,
  buildLinePath,
  buildTrendAveragePath,
  buildTrendDayPaths,
  buildTrendGeometry,
  buildTrendLevels,
  buildTrendSeparators,
  buildTrendTicks,
  downsample,
  flattenTrendPoints,
  formatMonthDay,
  locateTrendSlot,
  movingAverage,
  niceStep,
  slotFromX,
  trendBaseline
} from './chart-geometry'

/* ------------------------------------------------------------ fixture */

function makeDay(date: string, prices: number[], prevClose: number, avg = 0): MinuteTrend {
  return {
    code: 'sh600519',
    name: '贵州茅台',
    date,
    prevClose,
    points: prices.map((price, index) => ({
      time: String(930 + index).padStart(4, '0'),
      price,
      avg: price + avg,
      volume: 100 + index * 10
    }))
  }
}

const ONE_DAY = [makeDay('20260921', [100, 102, 101, 103, 105], 100)]
const FIVE_DAYS = [
  makeDay('20260915', [100, 101, 99], 98),
  makeDay('20260916', [99, 98, 97], 101),
  makeDay('20260917', [97, 99, 100], 97),
  makeDay('20260918', [100, 102, 101], 100),
  makeDay('20260921', [101, 103, 105], 101)
]

function makeBars(closes: number[]): KLineBar[] {
  return closes.map((close, index) => ({
    date: `2026-09-${String(index + 1).padStart(2, '0')}`,
    open: close - 1,
    close,
    high: close + 2,
    low: close - 3,
    volume: 1000 + index * 100
  }))
}

/* ------------------------------------------------------- 摊平与基准 */

describe('flattenTrendPoints', () => {
  it('单日：槽位就是点序号', () => {
    const flat = flattenTrendPoints(ONE_DAY)
    expect(flat.map((item) => item.slot)).toEqual([0, 1, 2, 3, 4])
    expect(flat.every((item) => item.dayIndex === 0)).toBe(true)
  })

  it('多日：第 N 天从 N × 241 开始，各天不重叠', () => {
    const flat = flattenTrendPoints(FIVE_DAYS)
    expect(flat[0].slot).toBe(0)
    expect(flat[3].slot).toBe(DAY_SLOTS) // 第二天的第一个点
    expect(flat[6].slot).toBe(DAY_SLOTS * 2)
    // 槽位严格递增
    for (let i = 1; i < flat.length; i++) {
      expect(flat[i].slot).toBeGreaterThan(flat[i - 1].slot)
    }
  })

  it('空数据返回空数组', () => {
    expect(flattenTrendPoints([])).toEqual([])
  })
})

describe('trendBaseline', () => {
  it('取最后一个交易日的昨收', () => {
    expect(trendBaseline(ONE_DAY)).toBe(100)
    expect(trendBaseline(FIVE_DAYS)).toBe(101)
  })

  it('没有数据时返回 0，不抛异常', () => {
    expect(trendBaseline([])).toBe(0)
  })
})

/* ------------------------------------------------------------ 几何 */

describe('buildTrendGeometry', () => {
  it('画布过小时返回 null，交给界面显示占位', () => {
    expect(buildTrendGeometry(ONE_DAY, 50, 400)).toBeNull()
    expect(buildTrendGeometry(ONE_DAY, 400, 50)).toBeNull()
    expect(buildTrendGeometry(ONE_DAY, 0, 0)).toBeNull()
  })

  it('没有数据时返回 null', () => {
    expect(buildTrendGeometry([], 800, 400)).toBeNull()
    expect(buildTrendGeometry([makeDay('20260921', [], 100)], 800, 400)).toBeNull()
  })

  it('横轴两端精确对齐绘图区左右边界', () => {
    const geo = buildTrendGeometry(ONE_DAY, 800, 400)!
    expect(geo.x(0)).toBeCloseTo(TREND_PADDING.left, 5)
    expect(geo.x(geo.totalSlots)).toBeCloseTo(800 - TREND_PADDING.right, 5)
  })

  it('单日：纵轴严格以昨收为中心对称', () => {
    const geo = buildTrendGeometry(ONE_DAY, 800, 400)!
    const baseline = 100
    expect(geo.yMax - baseline).toBeCloseTo(baseline - geo.yMin, 6)
    // 基准线落在价格区正中
    const center = (geo.priceTop + geo.priceBottom) / 2
    expect(geo.yPrice(baseline)).toBeCloseTo(center, 5)
  })

  it('单日：全天几乎不动时也不会除以 0', () => {
    const flatDay = [makeDay('20260921', [100, 100, 100], 100)]
    const geo = buildTrendGeometry(flatDay, 800, 400)!
    expect(Number.isFinite(geo.yPrice(100))).toBe(true)
    expect(geo.yMax).toBeGreaterThan(geo.yMin)
  })

  it('多日：纵轴覆盖全部交易日的最高最低价', () => {
    const geo = buildTrendGeometry(FIVE_DAYS, 800, 400)!
    const prices = FIVE_DAYS.flatMap((day) => day.points.map((point) => point.price))
    expect(geo.yMax).toBeGreaterThanOrEqual(Math.max(...prices))
    expect(geo.yMin).toBeLessThanOrEqual(Math.min(...prices))
  })

  it('多日：横轴槽位数为 天数 × 241 - 1', () => {
    const geo = buildTrendGeometry(FIVE_DAYS, 800, 400)!
    expect(geo.totalSlots).toBe(FIVE_DAYS.length * DAY_SLOTS - 1)
  })

  it('三个区域自上而下依次排布且不重叠', () => {
    const geo = buildTrendGeometry(ONE_DAY, 800, 400)!
    expect(geo.priceTop).toBeLessThan(geo.priceBottom)
    expect(geo.priceBottom).toBeLessThan(geo.volumeTop)
    expect(geo.volumeTop).toBeLessThan(geo.volumeBottom)
    expect(geo.volumeBottom).toBeLessThanOrEqual(400 - TREND_PADDING.bottom + 0.001)
  })

  it('价格越高纵坐标越小（y 轴向下）', () => {
    const geo = buildTrendGeometry(ONE_DAY, 800, 400)!
    expect(geo.yPrice(geo.yMax)).toBeLessThan(geo.yPrice(geo.yMin))
  })

  it('成交量柱宽度至少 1px（五日时每格很窄）', () => {
    const narrow = buildTrendGeometry(FIVE_DAYS, 200, 400)!
    expect(narrow.barWidth).toBeGreaterThanOrEqual(1)
  })

  it('成交量最大值兜底为 1，避免除以 0', () => {
    const zeroVolume: MinuteTrend[] = [
      {
        ...makeDay('20260921', [100], 100),
        points: [{ time: '0930', price: 100, avg: 100, volume: 0 }]
      }
    ]
    const geo = buildTrendGeometry(zeroVolume, 800, 400)!
    expect(geo.maxVolume).toBe(1)
    expect(Number.isFinite(geo.yVolume(0))).toBe(true)
  })
})

/* ---------------------------------------------------------- 纵轴刻度 */

describe('buildTrendLevels', () => {
  it('单日：一定包含昨收基准线，且 pct 为 0', () => {
    const geo = buildTrendGeometry(ONE_DAY, 800, 400)!
    const levels = buildTrendLevels(ONE_DAY, geo)
    const baseline = levels.find((level) => level.pct === 0)
    expect(baseline).toBeDefined()
    expect(baseline!.value).toBeCloseTo(100, 6)
  })

  it('单日：围绕基准线上下成对出现', () => {
    const geo = buildTrendGeometry(ONE_DAY, 800, 400)!
    const levels = buildTrendLevels(ONE_DAY, geo)
    const ups = levels.filter((level) => (level.pct ?? 0) > 0)
    const downs = levels.filter((level) => (level.pct ?? 0) < 0)
    expect(ups.length).toBe(downs.length)
  })

  it('单日：所有刻度都落在纵轴范围内', () => {
    const geo = buildTrendGeometry(ONE_DAY, 800, 400)!
    for (const level of buildTrendLevels(ONE_DAY, geo)) {
      expect(level.value).toBeGreaterThanOrEqual(geo.yMin - 1e-9)
      expect(level.value).toBeLessThanOrEqual(geo.yMax + 1e-9)
    }
  })

  it('单日：刻度从高到低排序（与 y 轴方向一致）', () => {
    const geo = buildTrendGeometry(ONE_DAY, 800, 400)!
    const values = buildTrendLevels(ONE_DAY, geo).map((level) => level.value)
    const sorted = [...values].sort((a, b) => b - a)
    expect(values).toEqual(sorted)
  })

  it('多日：没有统一基准，pct 一律为 null', () => {
    const geo = buildTrendGeometry(FIVE_DAYS, 800, 400)!
    const levels = buildTrendLevels(FIVE_DAYS, geo)
    expect(levels.length).toBeGreaterThan(0)
    expect(levels.every((level) => level.pct === null)).toBe(true)
  })

  it('昨收缺失（为 0）时回退到当天首个分时价，刻度照常可用', () => {
    // 这是有意的防御：接口没给昨收时不能让整个纵轴塌掉
    const broken = [makeDay('20260921', [100, 101], 0)]
    const geo = buildTrendGeometry(broken, 800, 400)!
    const levels = buildTrendLevels(broken, geo)
    expect(levels.length).toBeGreaterThan(0)
    expect(levels.find((level) => level.pct === 0)!.value).toBeCloseTo(100, 6)
  })

  it('价格本身为 0（脏数据）时返回空数组而不是除以 0', () => {
    const garbage: MinuteTrend[] = [
      {
        code: 'sh600519',
        name: '脏数据',
        date: '20260921',
        prevClose: 0,
        points: [{ time: '0930', price: 0, avg: 0, volume: 0 }]
      }
    ]
    const geo = buildTrendGeometry(garbage, 800, 400)!
    expect(buildTrendLevels(garbage, geo)).toEqual([])
  })
})

/* -------------------------------------------------------- 横轴与路径 */

describe('buildTrendTicks', () => {
  it('单日：给出五个时间刻，首尾对齐两端', () => {
    const ticks = buildTrendTicks(ONE_DAY)
    expect(ticks.map((tick) => tick.label)).toEqual([
      '09:30',
      '10:30',
      '11:30/13:00',
      '14:00',
      '15:00'
    ])
    expect(ticks[0].anchor).toBe('start')
    expect(ticks[ticks.length - 1].anchor).toBe('end')
  })

  it('多日：每个交易日一个 MM-DD 标签', () => {
    const ticks = buildTrendTicks(FIVE_DAYS)
    expect(ticks.map((tick) => tick.label)).toEqual(['09-15', '09-16', '09-17', '09-18', '09-21'])
    expect(ticks[1].slot).toBe(DAY_SLOTS)
  })
})

describe('buildTrendSeparators', () => {
  it('单日不画分隔线', () => {
    expect(buildTrendSeparators(ONE_DAY)).toEqual([])
  })

  it('五日给出 4 条分隔线', () => {
    expect(buildTrendSeparators(FIVE_DAYS)).toEqual([
      DAY_SLOTS,
      DAY_SLOTS * 2,
      DAY_SLOTS * 3,
      DAY_SLOTS * 4
    ])
  })
})

describe('buildTrendDayPaths', () => {
  it('每天段的颜色按「当天收盘 vs 当天昨收」判定', () => {
    const geo = buildTrendGeometry(FIVE_DAYS, 800, 400)!
    const paths = buildTrendDayPaths(FIVE_DAYS, geo)
    // 第一天 99 vs 昨收 98 → 涨
    expect(paths[0].tone).toBe('up')
    // 第二天 97 vs 昨收 101 → 跌
    expect(paths[1].tone).toBe('down')
  })

  it('路径以 M 开头，面积路径以 Z 收尾', () => {
    const geo = buildTrendGeometry(FIVE_DAYS, 800, 400)!
    const paths = buildTrendDayPaths(FIVE_DAYS, geo)
    for (const path of paths) {
      expect(path.line.startsWith('M')).toBe(true)
      expect(path.area.endsWith('Z')).toBe(true)
      expect(path.area.startsWith(path.line)).toBe(true)
    }
  })

  it('空的一天产生空路径而不是崩溃', () => {
    const withEmpty = [makeDay('20260921', [], 100), ...ONE_DAY]
    const geo = buildTrendGeometry(withEmpty, 800, 400)!
    const paths = buildTrendDayPaths(withEmpty, geo)
    expect(paths[0].line).toBe('')
    expect(paths[0].area).toBe('')
  })

  it('均价线路径贯穿所有交易日', () => {
    const geo = buildTrendGeometry(FIVE_DAYS, 800, 400)!
    const path = buildTrendAveragePath(FIVE_DAYS, geo)
    // 每天都以 M 起新段（多日时是 5 段）
    expect(path.match(/M/g)?.length).toBe(FIVE_DAYS.length)
  })
})

/* ---------------------------------------------------------- 槽位定位 */

describe('locateTrendSlot', () => {
  it('单日：槽位直接对应点序号', () => {
    expect(locateTrendSlot(0, ONE_DAY)).toEqual({ dayIndex: 0, pointIndex: 0 })
    expect(locateTrendSlot(3, ONE_DAY)).toEqual({ dayIndex: 0, pointIndex: 3 })
  })

  it('多日：跨过 241 就进入第二天', () => {
    expect(locateTrendSlot(DAY_SLOTS, FIVE_DAYS)).toEqual({ dayIndex: 1, pointIndex: 0 })
    expect(locateTrendSlot(DAY_SLOTS + 2, FIVE_DAYS)).toEqual({ dayIndex: 1, pointIndex: 2 })
  })

  it('超出该日实际点数时钳位到最后一个点', () => {
    // 每一天只有 3 个点，槽位 200 属于第一天但远超其点数
    expect(locateTrendSlot(200, FIVE_DAYS)).toEqual({ dayIndex: 0, pointIndex: 2 })
  })

  it('超出整条横轴时钳位到最后一个交易日的最后一个点', () => {
    expect(locateTrendSlot(99999, FIVE_DAYS)).toEqual({ dayIndex: 4, pointIndex: 2 })
  })

  it('负数槽位钳位到起点', () => {
    expect(locateTrendSlot(-50, FIVE_DAYS)).toEqual({ dayIndex: 0, pointIndex: 0 })
  })

  it('非法输入返回 null', () => {
    expect(locateTrendSlot(10, [])).toBeNull()
    expect(locateTrendSlot(NaN, FIVE_DAYS)).toBeNull()
    expect(locateTrendSlot(0, [makeDay('20260921', [], 100)])).toBeNull()
  })
})

describe('slotFromX', () => {
  it('左边界对应槽位 0，右边界对应最后一个槽位', () => {
    const geo = buildTrendGeometry(ONE_DAY, 800, 400)!
    expect(slotFromX(TREND_PADDING.left, 0, geo)).toBe(0)
    expect(slotFromX(800 - TREND_PADDING.right, 0, geo)).toBe(geo.totalSlots)
  })

  it('容器有偏移时依然正确（剔除容器左边距与画布留白）', () => {
    const geo = buildTrendGeometry(ONE_DAY, 800, 400)!
    expect(slotFromX(120 + TREND_PADDING.left, 120, geo)).toBe(0)
  })
})

/* ------------------------------------------------------------ K 线 */

describe('buildKLineGeometry', () => {
  const bars = makeBars([10, 12, 11, 13, 15, 14, 16, 18, 17, 19])

  it('空数据或画布过小返回 null', () => {
    expect(buildKLineGeometry([], 800, 400)).toBeNull()
    expect(buildKLineGeometry(bars, 60, 400)).toBeNull()
    expect(buildKLineGeometry(bars, 800, 60)).toBeNull()
  })

  it('纵轴覆盖全部最高最低价', () => {
    const geo = buildKLineGeometry(bars, 800, 400)!
    expect(geo.yMax).toBeGreaterThanOrEqual(Math.max(...bars.map((bar) => bar.high)))
    expect(geo.yMin).toBeLessThanOrEqual(Math.min(...bars.map((bar) => bar.low)))
  })

  it('每根 K 线居中于自己的槽位', () => {
    const geo = buildKLineGeometry(bars, 800, 400)!
    const first = geo.x(0)
    const second = geo.x(1)
    expect(second - first).toBeCloseTo(geo.slot, 6)
    expect(first - KLINE_PADDING.left).toBeCloseTo(geo.slot / 2, 6)
  })

  it('实体宽度至少 1px（K 线很多时）', () => {
    const many = makeBars(Array.from({ length: 300 }, (_, index) => 10 + Math.sin(index) * 3))
    const geo = buildKLineGeometry(many, 300, 400)!
    expect(geo.bodyWidth).toBeGreaterThanOrEqual(1)
  })

  it('成交量区在价格区下方', () => {
    const geo = buildKLineGeometry(bars, 800, 400)!
    expect(geo.priceBottom).toBeLessThan(geo.volumeBottom)
  })
})

describe('buildKLineLevels', () => {
  it('刻度递增且落在纵轴范围内', () => {
    const bars = makeBars([10, 12, 11, 13, 15, 14, 16, 18, 17, 19])
    const geo = buildKLineGeometry(bars, 800, 400)!
    const levels = buildKLineLevels(geo)
    expect(levels.length).toBeGreaterThan(1)
    for (let i = 1; i < levels.length; i++) {
      expect(levels[i]).toBeGreaterThan(levels[i - 1])
    }
    expect(levels[0]).toBeGreaterThanOrEqual(geo.yMin)
    expect(levels[levels.length - 1]).toBeLessThanOrEqual(geo.yMax)
  })
})

describe('buildKLineTicks', () => {
  it('首尾必然是第一根与最后一根', () => {
    const bars = makeBars(Array.from({ length: 50 }, (_, index) => 10 + index * 0.1))
    const ticks = buildKLineTicks(bars)
    expect(ticks[0].index).toBe(0)
    expect(ticks[ticks.length - 1].index).toBe(bars.length - 1)
    expect(ticks.length).toBeLessThanOrEqual(6)
  })

  it('数据少于刻度数时不会重复', () => {
    const bars = makeBars([10, 11, 12])
    const ticks = buildKLineTicks(bars)
    expect(new Set(ticks.map((tick) => tick.index)).size).toBe(ticks.length)
  })

  it('空数据返回空数组', () => {
    expect(buildKLineTicks([])).toEqual([])
  })
})

describe('movingAverage', () => {
  it('前 period-1 个位置为 null，之后是算术平均', () => {
    const bars = makeBars([1, 2, 3, 4, 5])
    const ma = movingAverage(bars, 3)
    expect(ma[0]).toBeNull()
    expect(ma[1]).toBeNull()
    expect(ma[2]).toBeCloseTo(2, 6)
    expect(ma[3]).toBeCloseTo(3, 6)
    expect(ma[4]).toBeCloseTo(4, 6)
  })

  it('周期为 1 时等于自身', () => {
    const bars = makeBars([5, 7, 9])
    expect(movingAverage(bars, 1)).toEqual([5, 7, 9])
  })

  it('数据不足一个周期时全是 null', () => {
    const bars = makeBars([1, 2])
    expect(movingAverage(bars, 5)).toEqual([null, null])
  })
})

describe('buildLinePath', () => {
  it('遇到 null 会另起一段 M', () => {
    const path = buildLinePath([{ x: 0, y: 0 }, { x: 1, y: 1 }, null, { x: 2, y: 2 }])
    expect(path).toBe('M0.00,0.00 L1.00,1.00 M2.00,2.00')
  })

  it('全是 null 时返回空串', () => {
    expect(buildLinePath([null, null])).toBe('')
  })
})

/* ------------------------------------------------------------ 工具 */

describe('niceStep', () => {
  it('步长永远是 1 / 2 / 5 × 10ⁿ', () => {
    for (const range of [0.7, 3, 12, 45, 130, 900, 4200]) {
      const step = niceStep(range, 5)
      const magnitude = Math.pow(10, Math.floor(Math.log10(step)))
      expect([1, 2, 5, 10]).toContain(Math.round(step / magnitude))
    }
  })

  it('非法输入返回 1 而不是 NaN', () => {
    expect(niceStep(0, 5)).toBe(1)
    expect(niceStep(-5, 5)).toBe(1)
    expect(niceStep(NaN, 5)).toBe(1)
  })
})

describe('formatMonthDay', () => {
  it('YYYYMMDD 转 MM-DD', () => {
    expect(formatMonthDay('20260921')).toBe('09-21')
  })

  it('格式不符时原样返回', () => {
    expect(formatMonthDay('2026-09-21')).toBe('2026-09-21')
  })
})

describe('downsample（迷你走势图降采样）', () => {
  it('点数不超上限时原样返回（且是副本，不共享引用）', () => {
    const values = [1, 2, 3]
    const result = downsample(values, 10)
    expect(result).toEqual([1, 2, 3])
    expect(result).not.toBe(values)
  })

  it('降采样后长度正好等于上限', () => {
    const values = Array.from({ length: 241 }, (_, index) => index)
    expect(downsample(values, 60)).toHaveLength(60)
  })

  it('末尾始终保留最新价（否则终点会和旁边的现价对不上）', () => {
    const values = Array.from({ length: 241 }, (_, index) => index)
    const result = downsample(values, 60)
    expect(result[result.length - 1]).toBe(240)
  })

  it('保留首点', () => {
    const values = Array.from({ length: 241 }, (_, index) => index)
    expect(downsample(values, 60)[0]).toBe(0)
  })

  it('上限为 0 时返回空数组而不是崩溃', () => {
    expect(downsample([1, 2, 3], 0)).toEqual([])
    expect(downsample([1, 2, 3], -1)).toEqual([])
  })

  it('恰好等于上限时不改动', () => {
    const values = [1, 2, 3, 4]
    expect(downsample(values, 4)).toEqual([1, 2, 3, 4])
  })
})
