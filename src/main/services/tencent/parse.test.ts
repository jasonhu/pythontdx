/**
 * 腾讯行情报文解析测试。
 *
 * fixture 全部是**从真实接口抓下来的原始报文**（2026-09 实测），
 * 不是手写的简化样例——只有真实报文才能覆盖到那些诡异的边界情况
 * （港股字段布局不同、收盘后补点、最后一根 K 线字段不全……）。
 */
import { describe, expect, it } from 'vitest'
import {
  normalizeStockName,
  parseKline,
  parseMinute,
  parseMultiDayTrend,
  parseQuoteFields,
  parseQuotePayload,
  parseSearch
} from './parse'

/* ------------------------------------------------------------ 真实报文 */

/** A 股：sh600519，88 个字段，逐字段取自真实响应 */
const A_SHARE_FIELDS = [
  '1',
  '贵州茅台',
  '600519',
  '1252.57',
  '1257.12',
  '1259.00',
  '25017',
  '11200',
  '13817',
  '1252.57',
  '1',
  '1252.56',
  '15',
  '1252.55',
  '110',
  '1252.50',
  '24',
  '1252.45',
  '1',
  '1252.86',
  '57',
  '1252.97',
  '1',
  '1253.00',
  '3',
  '1253.12',
  '1',
  '1253.13',
  '5',
  '',
  '20260921161437',
  '-4.55',
  '-0.36',
  '1259.95',
  '1250.80',
  '1252.57/25017/3135910045',
  '25017',
  '313591',
  '0.20',
  '19.23',
  '',
  '1259.95',
  '1250.80',
  '0.73',
  '15658.15',
  '15658.15',
  '6.23',
  '1382.83',
  '1131.41',
  '1.26',
  '84',
  '1253.52',
  '17.59',
  '19.02',
  '',
  '',
  '0.07',
  '313591.0045',
  '62.6285',
  '5',
  '   A',
  'GP-A',
  '-7.16',
  '-1.99',
  '4.15',
  '32.41',
  '27.30',
  '1539.98',
  '1151.01',
  '-4.82',
  '-3.99',
  '4.82',
  '1250081601',
  '1250081601',
  '38.53',
  '-8.76',
  '1250081601',
  '',
  '',
  '-11.54',
  '-0.06',
  '',
  'CNY',
  '0',
  '___D__F__N',
  '1252.43',
  '4',
  ''
]

const A_SHARE_LINE = `v_sh600519="${A_SHARE_FIELDS.join('~')}";`

/** 港股：hk00700，78 个字段，且从下标 30 往后含义与 A 股完全不同 */
function hkFields(): string[] {
  const fields = new Array<string>(78).fill('')
  const set = (index: number, value: string): void => {
    fields[index] = value
  }
  set(0, '100')
  set(1, '腾讯控股')
  set(2, '00700')
  set(3, '430.000')
  set(4, '419.000')
  set(5, '424.600')
  set(6, '19669333.0')
  set(30, '2026/09/21 16:08:36')
  set(31, '11.000')
  set(32, '2.63')
  set(33, '434.800')
  set(34, '423.000')
  set(37, '8422050831.000')
  set(38, '0')
  set(39, '15.71')
  set(43, '2.82')
  set(44, '39108.8698')
  set(45, '39108.8698')
  set(46, 'TENCENT') // 英文名，不是市净率
  set(47, '1.24')
  set(48, '677.700') // 52 周高，不是涨停价
  set(49, '411.000') // 52 周低，不是跌停价
  set(50, '1.08')
  set(51, '37.90')
  return fields
}

/**
 * 五日分时 / 当日分时的真实响应结构。
 * 重点：`qt` 嵌在 `data.<代码>` 里面，不在顶层。
 */
const MINUTE_RESPONSE = {
  code: 0,
  data: {
    sh600519: {
      data: {
        date: '20260921',
        data: [
          '0930 1259.00 241 30341900.00',
          '0931 1256.46 1243 156138386.00',
          '0932 1259.93 1534 192763792.56',
          '1131 1258.00 2000 250000000.00', // 午休时段，必须被过滤
          '1301 1255.00 2100 260000000.00',
          '1500 1252.57 25017 3136550118.69',
          '1529 1252.57 25022 3136550118.69', // 收盘后的补点，必须被过滤
          '1530 1252.57 25022 3136550118.69'
        ]
      },
      qt: { sh600519: ['1', '贵州茅台', '600519', '1252.57', '1257.12', '1259.00'] }
    }
  }
}

const KLINE_RESPONSE = {
  code: 0,
  msg: '',
  data: {
    sh600519: {
      qfqday: [
        ['2026-09-14', '1277.270', '1277.960', '1285.530', '1270.360', '16571.000'],
        ['2026-09-18', '1262.990', '1257.120', '1265.880', '1256.100', '24891.000'],
        // 当日这根只有 6 个字段且成交量是整数
        ['2026-09-21', '1259.00', '1252.57', '1259.95', '1250.80', '25017']
      ],
      qt: { sh600519: ['1', '贵州茅台', '600519', '1252.57', '1257.12', '1259.00'] }
    }
  }
}

/* ------------------------------------------------------------ 实时行情 */

describe('parseQuotePayload（A 股）', () => {
  const quote = parseQuotePayload(A_SHARE_LINE)[0]

  it('解析出基本字段', () => {
    expect(quote.code).toBe('sh600519')
    expect(quote.symbol).toBe('600519')
    expect(quote.name).toBe('贵州茅台')
    expect(quote.market).toBe('SH')
    expect(quote.price).toBe(1252.57)
    expect(quote.prevClose).toBe(1257.12)
    expect(quote.open).toBe(1259.0)
    expect(quote.high).toBe(1259.95)
    expect(quote.low).toBe(1250.8)
  })

  it('涨跌额与涨跌幅取接口原值', () => {
    expect(quote.change).toBe(-4.55)
    expect(quote.changePct).toBe(-0.36)
  })

  it('成交额从「万元」换算成「元」', () => {
    // 字段 37 是 313591 万元 = 31.3591 亿元
    expect(quote.amount).toBe(313591 * 1e4)
    expect(quote.amount).toBe(3_135_910_000)
  })

  it('买卖五档按「价、量」成对读取', () => {
    expect(quote.bids).toHaveLength(5)
    expect(quote.bids[0]).toEqual({ price: 1252.57, volume: 1 })
    expect(quote.bids[4]).toEqual({ price: 1252.45, volume: 1 })
    expect(quote.asks).toHaveLength(5)
    expect(quote.asks[0]).toEqual({ price: 1252.86, volume: 57 })
  })

  it('时间按东八区解析（与运行机器的时区无关）', () => {
    // 2026-09-21 16:14:37 +08:00 = 2026-09-21T08:14:37Z
    expect(new Date(quote.time).toISOString()).toBe('2026-09-21T08:14:37.000Z')
  })

  it('估值类字段', () => {
    expect(quote.turnoverRate).toBe(0.2)
    expect(quote.peTtm).toBe(19.23)
    expect(quote.pb).toBe(6.23)
    expect(quote.limitUp).toBe(1382.83)
    expect(quote.limitDown).toBe(1131.41)
    expect(quote.totalCap).toBe(15658.15)
    expect(quote.currency).toBe('CNY')
  })

  it('匹配不到代码时不产生数据', () => {
    expect(parseQuotePayload('v_pv_none_match="1";')).toEqual([])
  })
})

describe('parseQuoteFields（港股）', () => {
  const quote = parseQuoteFields('hk00700', hkFields())

  it('字段布局与 A 股不同，不能套用同一套下标', () => {
    expect(quote.market).toBe('HK')
    expect(quote.name).toBe('腾讯控股')
    expect(quote.price).toBe(430)
    expect(quote.prevClose).toBe(419)
  })

  it('时间格式带斜杠也要能解析', () => {
    expect(new Date(quote.time).toISOString()).toBe('2026-09-21T08:08:36.000Z')
  })

  it('港股没有涨跌停与市净率，一律降级为 undefined', () => {
    expect(quote.limitUp).toBeUndefined()
    expect(quote.limitDown).toBeUndefined()
    expect(quote.pb).toBeUndefined()
    // 下标 46 是英文名，绝不能被当成市净率
    expect(quote.pb).not.toBe(1.24)
  })

  it('成交额单位是「元」，不需要 ×1e4', () => {
    expect(quote.amount).toBe(8422050831)
  })

  it('币种缺省为 HKD', () => {
    expect(quote.currency).toBe('HKD')
  })
})

describe('停牌与异常数据兜底', () => {
  it('最新价为 0 时用昨收兜底，避免出现 -100% 的离谱涨跌幅', () => {
    const fields = [...A_SHARE_FIELDS]
    fields[3] = '0' // 最新价
    fields[31] = '0' // 涨跌额
    fields[32] = '0' // 涨跌幅
    const quote = parseQuoteFields('sh600519', fields)
    expect(quote.price).toBe(1257.12)
  })
})

/* -------------------------------------------------------------- 分时 */

describe('parseMinute', () => {
  const trend = parseMinute('sh600519', MINUTE_RESPONSE)

  it('昨收从 data.<代码>.qt 里取（回归测试）', () => {
    // 曾经的 bug：按响应顶层读 qt，拿到 undefined → 昨收变 0 →
    // 涨跌幅算出 Infinity → 界面上显示成「—%」
    expect(trend.prevClose).toBe(1257.12)
    expect(Number.isFinite(trend.prevClose)).toBe(true)
  })

  it('带上股票名称与交易日', () => {
    expect(trend.name).toBe('贵州茅台')
    expect(trend.date).toBe('20260921')
  })

  it('过滤午休时段与收盘后的补点', () => {
    const times = trend.points.map((point) => point.time)
    expect(times).toEqual(['0930', '0931', '0932', '1301', '1500'])
    expect(times).not.toContain('1131')
    expect(times).not.toContain('1530')
  })

  it('累计成交量要转成每分钟增量', () => {
    expect(trend.points.map((point) => point.volume)).toEqual([241, 1002, 291, 566, 22917])
  })

  it('均价 = 累计成交额 ÷ 累计成交股数（手 × 100）', () => {
    // 30341900 / (241 × 100) = 1259.00
    expect(trend.points[0].avg).toBeCloseTo(1259.0, 2)
  })

  it('港股每手股数不同，用 sharesPerLot=1 换算', () => {
    const hk = parseMinute('sh600519', MINUTE_RESPONSE, { sharesPerLot: 1 })
    // 30341900 / (241 × 1) ≈ 125900
    expect(hk.points[0].avg).toBeCloseTo(30341900 / 241, 2)
  })

  it('响应缺字段时不抛异常', () => {
    expect(parseMinute('sh600519', {}).points).toEqual([])
    expect(parseMinute('sh600519', {}).prevClose).toBe(0)
  })
})

/* -------------------------------------------------------------- K 线 */

describe('parseKline', () => {
  const series = parseKline('sh600519', 'day', KLINE_RESPONSE)

  it('读取前复权键 qfqday', () => {
    expect(series.bars).toHaveLength(3)
    expect(series.period).toBe('day')
  })

  it('字段顺序是「开、收、高、低」而不是常见的 OHLC', () => {
    expect(series.bars[0]).toEqual({
      date: '2026-09-14',
      open: 1277.27,
      close: 1277.96,
      high: 1285.53,
      low: 1270.36,
      volume: 16571
    })
  })

  it('最后一根字段不全、成交量是整数也能解析', () => {
    expect(series.bars[2].date).toBe('2026-09-21')
    expect(series.bars[2].close).toBe(1252.57)
    expect(series.bars[2].volume).toBe(25017)
  })

  it('不复权时键名是 day，同样兼容', () => {
    const raw = { data: { sh600519: { day: [['2026-09-21', '1', '2', '3', '0.5', '100']] } } }
    expect(parseKline('sh600519', 'day', raw).bars[0].close).toBe(2)
  })

  it('空数据不抛异常', () => {
    expect(parseKline('sh600519', 'day', {}).bars).toEqual([])
  })
})

/* -------------------------------------------------------------- 搜索 */

describe('parseSearch', () => {
  it('解析多条目联想结果', () => {
    const items = parseSearch('v_hint="sh~600519~贵州茅台~gzmt~GP-A^sz~000858~五粮液~wly~GP-A";')
    expect(items).toHaveLength(2)
    expect(items[0]).toEqual({
      code: 'sh600519',
      symbol: '600519',
      name: '贵州茅台',
      market: 'SH',
      kind: 'GP-A'
    })
    expect(items[1].code).toBe('sz000858')
  })

  it('无结果返回空数组', () => {
    expect(parseSearch('v_hint="N";')).toEqual([])
    expect(parseSearch('')).toEqual([])
  })

  it('条目以 ^ 结尾时不产生空条目', () => {
    const items = parseSearch('v_hint="sh~600519~贵州茅台~gzmt~GP-A^";')
    expect(items).toHaveLength(1)
  })

  it('未带 ^ 的多条目（单条）也能解析', () => {
    expect(parseSearch('v_hint="hk~00700~腾讯控股~txkg~GP"')[0].market).toBe('HK')
  })
})

/* -------------------------------------------------------- 名称规范化 */

describe('normalizeStockName', () => {
  it('去掉中文名里的对齐填充空格（回归测试）', () => {
    // 腾讯对不足 4 个字的名字会用空格补齐，实测样例
    expect(normalizeStockName('五 粮 液')).toBe('五粮液')
    expect(normalizeStockName('万  科Ａ')).toBe('万科Ａ')
    expect(normalizeStockName('南  玻Ａ')).toBe('南玻Ａ')
    expect(normalizeStockName('特  力Ａ')).toBe('特力Ａ')
  })

  it('不含空格的名字原样保留', () => {
    expect(normalizeStockName('贵州茅台')).toBe('贵州茅台')
    expect(normalizeStockName('比亚迪')).toBe('比亚迪')
    expect(normalizeStockName('腾讯控股')).toBe('腾讯控股')
  })

  it('含英文字母时保留有意义的空格（港股英文名）', () => {
    // hk00033 的真实名字，空格不能抹掉，否则会变成 INTLGENIUS
    expect(normalizeStockName('INTL GENIUS')).toBe('INTL GENIUS')
    expect(normalizeStockName('CHINA  MOBILE')).toBe('CHINA MOBILE')
  })

  it('首尾空白一律去掉', () => {
    expect(normalizeStockName('  贵州茅台  ')).toBe('贵州茅台')
    expect(normalizeStockName('  INTL GENIUS ')).toBe('INTL GENIUS')
  })

  it('空字符串返回空串', () => {
    expect(normalizeStockName('')).toBe('')
    expect(normalizeStockName('   ')).toBe('')
  })
})

describe('名称规范化在行情解析里生效', () => {
  it('五粮液不会带着空格进入界面', () => {
    const fields = [...A_SHARE_FIELDS]
    fields[1] = '五 粮 液'
    expect(parseQuoteFields('sz000858', fields).name).toBe('五粮液')
  })

  it('港股英文名保持原样', () => {
    const fields = hkFields()
    fields[1] = 'INTL GENIUS'
    expect(parseQuoteFields('hk00033', fields).name).toBe('INTL GENIUS')
  })

  it('名字缺失时退化成代码', () => {
    const fields = [...A_SHARE_FIELDS]
    fields[1] = ''
    expect(parseQuoteFields('sh600519', fields).name).toBe('600519')
  })
})

/* ---------------------------------------------------------- 五日分时 */

/**
 * day/query 的真实结构：`data.<代码>.data` 是**数组**（不是按日期作键的对象），
 * 且顺序是「新 → 旧」，与直觉相反。
 */
const FIVE_DAY_RESPONSE = {
  code: 0,
  data: {
    sh600519: {
      data: [
        {
          date: '20260921',
          data: ['0930 1259.00 241 30341900.00', '1500 1252.57 25017 3136550118.69']
        },
        {
          date: '20260918',
          data: ['0930 1262.99 113 14271787.32', '1500 1257.12 24891 3000000000.00']
        },
        {
          date: '20260917',
          data: ['0930 1257.98 140 17611720.00', '1500 1266.98 17554 2000000000.00']
        }
      ],
      qt: { sh600519: ['1', '贵州茅台', '600519', '1252.57', '1257.12', '1259.00'] }
    }
  }
}

describe('parseMultiDayTrend', () => {
  const multi = parseMultiDayTrend('sh600519', FIVE_DAY_RESPONSE)

  it('输出按「从旧到新」排列，方便左旧右新地画图', () => {
    expect(multi.days.map((day) => day.date)).toEqual(['20260917', '20260918', '20260921'])
  })

  it('带上名称', () => {
    expect(multi.name).toBe('贵州茅台')
    expect(multi.code).toBe('sh600519')
  })

  it('最新一天的昨收取接口快照', () => {
    expect(multi.days[2].prevClose).toBe(1257.12)
  })

  it('更早的那些天，昨收 = 再早一天的最后成交价', () => {
    // 20260918 的前一交易日是 20260917，其收盘价 1266.98
    expect(multi.days[1].prevClose).toBe(1266.98)
  })

  it('最早的一天没有更早数据，退化用当天首个分时价当基准', () => {
    expect(multi.days[0].prevClose).toBe(1257.98)
  })

  it('每天各自独立地把累计成交量换算成增量', () => {
    // 每天都是从 0 开始累计的，第一天不能被前一天的数据带偏
    expect(multi.days[0].points[0].volume).toBe(140)
    expect(multi.days[1].points[0].volume).toBe(113)
    expect(multi.days[2].points[0].volume).toBe(241)
  })

  it('空响应不抛异常', () => {
    expect(parseMultiDayTrend('sh600519', {}).days).toEqual([])
  })
})
