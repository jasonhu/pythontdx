import { describe, expect, it } from 'vitest'
import { parseF10 } from './f10'

const table = (rows: string[]): string => rows.join('\n')

describe('parseF10', () => {
  it('把 ULC 框线表还原成表格，并合并折行的第一列', () => {
    const source = table([
      '●最新主要指标',
      '┌──────────────┬────────────┬────────────┐',
      '│●最新主要指标 │ 2026-09-30 │ 2026-06-30 │',
      '├──────────────┼────────────┼────────────┤',
      '│每股收益(元)  │     0.3200 │     0.2300 │',
      '│加权净资产收益率(%│    2.3000 │    1.6700 │',
      '│)             │            │            │',
      '└──────────────┴────────────┴────────────┘'
    ])
    const blocks = parseF10(source)
    const parsed = blocks.find((block) => block.kind === 'table')
    expect(parsed?.kind).toBe('table')
    if (parsed?.kind !== 'table') return
    expect(parsed.rows[0]).toEqual(['●最新主要指标', '2026-09-30', '2026-06-30'])
    expect(parsed.rows[1]).toEqual(['每股收益(元)', '0.3200', '0.2300'])
    // 折行尾巴 ")" 接回上一行，而不是单独一行
    expect(parsed.rows[2]?.[0]).toBe('加权净资产收益率(%)')
    expect(parsed.numeric).toEqual([false, true, true])
    expect(blocks.some((block) => block.kind === 'text' && /[│┌└]/.test(block.text))).toBe(false)
  })

  it('单列框线只是包了一段公告，按正文输出而不是表格', () => {
    const source = table([
      '┌──────────────────────────────┐',
      '│●最新公告:2026-10-30 利元亨（688499）│',
      '│后）                          │',
      '└──────────────────────────────┘'
    ])
    const blocks = parseF10(source)
    expect(blocks.some((block) => block.kind === 'table')).toBe(false)
    const text = blocks
      .filter((block) => block.kind === 'text')
      .map((block) => block.text)
      .join('\n')
    expect(text).toContain('●最新公告')
    expect(text).toContain('后）')
    expect(text).not.toContain('│')
  })

  it('【标题】单独成块，正文按原顺序保留', () => {
    const blocks = parseF10('前言\n【1.最新提示】\n正文一\n正文二')
    expect(blocks.map((block) => block.kind)).toEqual(['text', 'heading', 'text'])
    expect(blocks[1]).toMatchObject({ kind: 'heading', text: '【1.最新提示】' })
  })

  it('兼容全角 ｜ 与 ASCII | 分隔，并去掉表头分隔线', () => {
    const source = table(['名称｜数值', ':--|--:', '营收｜123.45'])
    const blocks = parseF10(source)
    const parsed = blocks.find((block) => block.kind === 'table')
    if (parsed?.kind !== 'table') throw new Error('没有解析出表格')
    expect(parsed.rows).toEqual([
      ['名称', '数值'],
      ['营收', '123.45']
    ])
    expect(parsed.numeric).toEqual([false, true])
  })

  it('把折行尾巴接回上一行，不单独一行标点', () => {
    const blocks = parseF10('●公告（详见\n后）\n●下一条')
    const text = blocks
      .filter((block) => block.kind === 'text')
      .map((block) => block.text)
      .join('\n')
    expect(text).toContain('●公告（详见后）')
    expect(text).not.toMatch(/^后）$/m)
  })

  it('把空格对齐 + ─── 分隔线的表还原成表格，并合并折行单元格', () => {
    const source = [
      '股东名称                       股份性质     持股数(万)  占总股本比%',
      '─────────────────────────────────────────────────',
      '惠州市利元亨投资有限公司       流通A股         5614.33        33.27',
      '重庆煊林企业管理合伙企业(有限  流通A股          189.86         1.13',
      '合伙)',
      '卢家红                         流通A股          330.31         1.96',
      '─────────────────────────────────────────────────',
      '注：以上数据来自 2026-09-30'
    ].join('\n')
    const blocks = parseF10(source)
    const parsed = blocks.find((block) => block.kind === 'table')
    if (parsed?.kind !== 'table') throw new Error('没有解析出空格对齐表')
    expect(parsed.rows[0]).toEqual(['股东名称', '股份性质', '持股数(万)', '占总股本比%'])
    expect(parsed.rows[1]?.[0]).toBe('惠州市利元亨投资有限公司')
    expect(parsed.rows[2]?.[0]).toBe('重庆煊林企业管理合伙企业(有限合伙)')
    expect(parsed.rows[3]?.[0]).toBe('卢家红')
    expect(parsed.numeric).toEqual([false, false, true, true])
    // 分隔线之后是正文，不能混进表格
    const tail = blocks
      .filter((block) => block.kind === 'text')
      .map((block) => block.text)
      .join('\n')
    expect(tail).toContain('注：以上数据来自 2026-09-30')
  })

  it('没有表头的空格对齐列表也能变成表格', () => {
    const source = [
      '较上个报告期退出前十大流通股东',
      '中国建设银行股份有限公司-易方达国证机器人  流通A股  211.87  1.26  退出',
      '梁龙震                                     流通A股   63.76  0.38  退出',
      '赖明                                       流通A股   63.50  0.38  退出',
      '曾巧美                                     流通A股   55.14  0.33  退出'
    ].join('\n')
    const blocks = parseF10(source)
    const parsed = blocks.find((block) => block.kind === 'table')
    if (parsed?.kind !== 'table') throw new Error('没有解析出无表头列表')
    expect(parsed.headerless).toBe(true)
    expect(parsed.rows).toHaveLength(4)
    expect(parsed.rows[0]?.[0]).toContain('中国建设银行')
    expect(parsed.numeric[2]).toBe(true)
  })

  it('表头第二行的多个单位都并回对应列', () => {
    const source = [
      '┌────┬──────┬──────┐',
      '│项目│营业收入│营业利润│',
      '│    │  (万元)│  (万元)│',
      '├────┼──────┼──────┤',
      '│主营│ 100.00│  20.00│',
      '└────┴──────┴──────┘'
    ].join('\n')
    const blocks = parseF10(source)
    const table = blocks.find((block) => block.kind === 'table')
    if (table?.kind !== 'table') throw new Error('没有解析出表头单位表')
    expect(table.rows[0]).toEqual(['项目', '营业收入(万元)', '营业利润(万元)'])
  })

  it('公告摘要表按行挂上附件链接，重复明细收起来', () => {
    const source = [
      '【1.公告列表】',
      '┌──────────┬──────┐',
      '│日期      │标题  │',
      '├──────────┼──────┤',
      '│2026-10-30│公告A │',
      '│2026-10-30│公告B │',
      '└──────────┴──────┘',
      '公告A。公告详情请查看附件',
      'http://example.com/a.pdf',
      '公告B。公告详情请查看附件',
      'http://example.com/b.pdf'
    ].join('\n')
    const blocks = parseF10(source)
    const table = blocks.find((block) => block.kind === 'table')
    if (table?.kind !== 'table') throw new Error('没有解析出公告表')
    expect(table.links).toEqual([undefined, 'http://example.com/a.pdf', 'http://example.com/b.pdf'])
    expect(blocks.some((block) => block.kind === 'link')).toBe(false)
    expect(blocks.some((block) => block.kind === 'text' && block.text.includes('公告A'))).toBe(false)
  })

  it('普通数据表后面的链接不会被当成公告明细', () => {
    const source = `┌──────┬──────┐
│项目  │数值  │
│A     │1.00  │
└──────┴──────┘
http://example.com/news1
http://example.com/news2`
    const blocks = parseF10(source)
    expect(blocks.some((block) => block.kind === 'table')).toBe(true)
    expect(blocks.filter((block) => block.kind === 'link')).toHaveLength(2)
  })

  it('明细比摘要表多时删掉摘要，只保留完整明细', () => {
    const source = [
      '【1.公告列表】',
      '┌──────┬──────┐',
      '│日期  │标题  │',
      '│2026-10-30│公告A │',
      '└──────┴──────┘',
      '2026-10-30 公告A。公告详情请查看附件',
      'http://example.com/a.pdf',
      '2026-10-29 公告B。公告详情请查看附件',
      'http://example.com/b.pdf',
      '2026-10-28 公告C。公告详情请查看附件',
      'http://example.com/c.pdf'
    ].join('\n')
    const blocks = parseF10(source)
    expect(blocks.some((block) => block.kind === 'table')).toBe(false)
    expect(blocks.filter((block) => block.kind === 'link')).toHaveLength(3)
    const text = blocks
      .filter((block) => block.kind === 'text')
      .map((block) => block.text)
      .join('\n')
    expect(text).toContain('公告B')
    expect(text).not.toContain('公告详情请查看附件')
  })

  it('公告/报道的 URL 单独成 link 块', () => {
    const url = 'https://static.sse.com.cn/disclosure/listedinfo/announcement/c/new/2026-10-31/688499_20261031_KGYB.pdf'
    const blocks = parseF10(`利元亨（688499）：关于授予限制性股票的公告。公告详情请查看附件\n${url}\n2026-10-30 17:34  下一条`)
    const link = blocks.find((block) => block.kind === 'link')
    expect(link).toEqual({ kind: 'link', url })
  })


  it('相邻表头只隔一个空格时也能拆出独立列', () => {
    const source = `均价 剩余股数(万) 变动途径
────────────────────
44.15 0.32 二级市场买卖
14.00 1.06 股权激励`
    const blocks = parseF10(source)
    const table = blocks.find((block) => block.kind === 'table')
    if (table?.kind !== 'table') throw new Error('没有解析出高管表')
    expect(table.rows[0]).toEqual(['均价', '剩余股数(万)', '变动途径'])
    expect(table.rows[1]).toEqual(['44.15', '0.32', '二级市场买卖'])
  })

  it('公司概况这种 2/4 列键值表渲染为 kv', () => {
    const source = `┌──────┬──────────────┬──────┬──────┐
│公司名称│广东利元亨智能装备股份有限公司│      │      │
│英文全称│Guangdong Lyric Robot Automation Co., Ltd.│      │      │
│证券简称│利元亨                    │证券代码│688499│
└──────┴──────────────┴──────┴──────┘`
    const blocks = parseF10(source)
    const kv = blocks.find((block) => block.kind === 'kv')
    if (kv?.kind !== 'kv') throw new Error('没有解析出键值表')
    expect(kv.pairs).toHaveLength(4)
    expect(kv.pairs[0]).toEqual({ label: '公司名称', value: '广东利元亨智能装备股份有限公司' })
    expect(kv.pairs[3]).toEqual({ label: '证券代码', value: '688499' })
  })

  it('「★本栏包括」折行里的【5.xxx】不是章节标题', () => {
    const source = [
      '公司概况☆ ◇688499 利元亨',
      '★本栏包括【1.基本资料】【2.发行和交易】【3.员工效益】【4.研发投入】',
      '          【5.参股控股】【6.关联交易】',
      '          【9.重大事项】',
      '',
      '【1.基本资料】',
      '公司名称 广东利元亨智能装备股份有限公司'
    ].join('\n')
    const blocks = parseF10(source)
    const headings = blocks.filter((block) => block.kind === 'heading').map((block) => block.text)
    expect(headings).toEqual(['【1.基本资料】'])
    const text = blocks
      .filter((block) => block.kind === 'text')
      .map((block) => block.text)
      .join('\n')
    expect(text).toContain('【5.参股控股】')
    expect(text).toContain('【9.重大事项】')
  })

  it('框线表的多行表头与名称折行都接回同一行', () => {
    const source = [
      '【2.股权投资】',
      '┌─────────┬─────┬─────┐',
      '│所持对象          │(初始)投资│  币种│',
      '│                  │    (万元)│      │',
      '├─────────┼─────┼─────┤',
      '│苏州朝希优势壹号产│   3000.00│人民币│',
      '│业投资合伙企业（有│          │      │',
      '│限合伙）          │          │      │',
      '├─────────┼─────┼─────┤',
      '│曼恩斯特          │   1500.00│人民币│',
      '└─────────┴─────┴─────┘'
    ].join('\n')
    const blocks = parseF10(source)
    const table = blocks.find((block) => block.kind === 'table')
    if (table?.kind !== 'table') throw new Error('没有解析出投资表')
    expect(table.rows[0]).toEqual(['所持对象', '(初始)投资(万元)', '币种'])
    expect(table.rows[1]?.[0]).toBe('苏州朝希优势壹号产业投资合伙企业（有限合伙）')
    expect(table.rows[2]?.[0]).toBe('曼恩斯特')
  })

  it('第一列空、后续列折行的单元格按列接回上一行', () => {
    const source = [
      '┌──────┬──────────────┐',
      '│项目    │内容                    │',
      '├──────┼──────────────┤',
      '│经营范围│一般项目：工业机器人制造│',
      '│      │；工业设计服务          │',
      '└──────┴──────────────┘'
    ].join('\n')
    const blocks = parseF10(source)
    const table = blocks.find((block) => block.kind === 'table')
    if (table?.kind !== 'table') throw new Error('没有解析出经营范围表')
    expect(table.rows[1]?.[1]).toBe('一般项目：工业机器人制造；工业设计服务')
  })

  it('同一张表被分隔线分段时并回上一张表', () => {
    const source = `项目名          营业收入(元)  收入比例(%)
────────────────────────────
锂电池设备      14.46亿        73.77
────────────────────────────
中国大陆(地区)  19.22亿        98.06
其他国家(地区)  3808.50万       1.94`
    const blocks = parseF10(source)
    const tables = blocks.filter((block) => block.kind === 'table')
    expect(tables).toHaveLength(1)
    if (tables[0]?.kind !== 'table') throw new Error('没有解析出表')
    expect(tables[0].rows).toHaveLength(4)
    expect(tables[0].rows[2]?.[0]).toBe('中国大陆(地区)')
  })

  it('按地区汇总的行（带亿/万）也能成无表头表', () => {
    const source = `中国大陆(地区)                          19.22亿        98.06       4.76亿        99.50      24.76
其他国家或地区(地区)                  3808.50万         1.94     237.38万         0.50       6.23`
    const blocks = parseF10(source)
    const table = blocks.find((block) => block.kind === 'table')
    if (table?.kind !== 'table') throw new Error('没有解析出地区表')
    expect(table.headerless).toBe(true)
    expect(table.rows).toHaveLength(2)
    expect(table.rows[0]?.[0]).toBe('中国大陆(地区)')
  })

  it('带「亿/万」单位的列仍按数字右对齐', () => {
    const source = [
      '项目名          营业收入(元)  收入比例(%)',
      '──────────────────────────────────',
      '锂电池制造设备      14.46亿        73.77',
      '其他业务          1915.56万         0.62'
    ].join('\n')
    const blocks = parseF10(source)
    const table = blocks.find((block) => block.kind === 'table')
    if (table?.kind !== 'table') throw new Error('没有解析出经营分析表')
    expect(table.numeric).toEqual([false, true, true])
  })
})
