/**
 * 个股行情头部：名称、代码、最新价、涨跌，以及一排核心指标。
 */
import { createEffect, createSignal, type JSX } from 'solid-js'
import { MARKET_LABEL, type Quote } from '@shared/types'
import { compactAmount, compactVolume, fixed, signed, signedPct, timeOfDay } from '@shared/format'
import { createValueFlash } from '../lib/dom'
import { toneOf, type Tone } from '../lib/tone'
import { addWatchItem, defaultGroup, removeWatchItem } from '../stores/app'
import { api } from '../lib/ipc'
import { IconStar, IconStarFilled } from './Icons'

export interface QuoteHeaderProps {
  quote: Quote
  onOpenF10: () => void
  onOpenAnnouncements: () => void
}

export function QuoteHeader(props: QuoteHeaderProps): JSX.Element {
  const tone = (): Tone => toneOf(props.quote.changePct)
  const flash = createValueFlash(() => props.quote.price)
  const [baseVolume, setBaseVolume] = createSignal<number | undefined>(undefined)
  let volumeRequest = 0
  const limits = (): { up?: number; down?: number } => limitPrices(props.quote)
  const volumeRatio = (): number | undefined =>
    props.quote.volumeRatio ??
    (baseVolume() && baseVolume()! > 0 ? props.quote.volume / baseVolume()! : undefined)

  createEffect(() => {
    const code = props.quote.code
    const request = ++volumeRequest
    setBaseVolume(undefined)
    void (async () => {
      try {
        const kline = await api.trend.kline({ code, period: 'day', count: 6 })
        if (request !== volumeRequest || kline.bars.length < 2) return
        const history = kline.bars.slice(0, -1).slice(-5)
        const average =
          history.reduce((sum, bar) => sum + bar.volume, 0) / Math.max(1, history.length)
        if (average > 0) setBaseVolume(average)
      } catch {
        // 量比是辅助值，失败保持 —
      }
    })()
  })

  // 星标只代表「在自选股里」；同一只票还可以同时属于多个自定义板块
  const inWatchlist = (): boolean =>
    defaultGroup()?.items.some((item) => item.code === props.quote.code) === true

  /** 涨停 / 跌停判定（接口直接给了涨跌停价，顺手做个醒目标记） */
  const limitState = (): 'up' | 'down' | null => {
    const { price, limitUp, limitDown } = props.quote
    if (limitUp !== undefined && price >= limitUp - 1e-6) return 'up'
    if (limitDown !== undefined && price <= limitDown + 1e-6) return 'down'
    return null
  }

  const toggleWatch = (): void => {
    if (inWatchlist()) {
      removeWatchItem(props.quote.code)
    } else {
      addWatchItem({
        code: props.quote.code,
        name: props.quote.name,
        market: props.quote.market
      })
    }
  }

  return (
    <section class="card quote-header animate-rise">
      <div class="quote-header__top">
        <div class="quote-header__identity">
          <div class="quote-header__name">
            <span>{props.quote.name}</span>
            <span class="tag">{MARKET_LABEL[props.quote.market]}</span>
            {limitState() === 'up' && <span class="tag tag--up">涨停</span>}
            {limitState() === 'down' && <span class="tag tag--down">跌停</span>}

            <button
              class="btn btn--icon btn--bare"
              title={inWatchlist() ? '移出自选' : '加入自选'}
              onClick={toggleWatch}
              style={{ color: inWatchlist() ? 'var(--chart-avg)' : 'var(--text-3)' }}
            >
              {inWatchlist() ? <IconStarFilled size={14} /> : <IconStar size={14} />}
            </button>
            <button
              class="btn btn--bare f10-open"
              title="F10 公司资料"
              onClick={() => props.onOpenF10()}
            >
              F10
            </button>
            <button
              class="btn btn--bare announcements-open"
              title="在线公告"
              onClick={() => props.onOpenAnnouncements()}
            >
              公告
            </button>
          </div>

          <div class="quote-header__code num">
            {props.quote.code.toUpperCase()} · {props.quote.currency} · 接收时间{' '}
            {timeOfDay(props.quote.time)}
          </div>
        </div>

        <div class="quote-header__price-block">
          <div
            class="quote-header__price num"
            classList={{
              [tone()]: true,
              'quote-header__price--up': flash() === 'up',
              'quote-header__price--down': flash() === 'down'
            }}
          >
            {fixed(props.quote.price)}
          </div>
          <div class="quote-header__delta num" classList={{ [tone()]: true }}>
            <span>{signed(props.quote.change)}</span>
            <span>{signedPct(props.quote.changePct)}</span>
          </div>
        </div>
      </div>

      <div class="quote-metrics">
        <Metric
          label="今开"
          value={fixed(props.quote.open)}
          tone={toneOf(props.quote.open - props.quote.prevClose)}
        />
        <Metric label="最高" value={fixed(props.quote.high)} tone="up" />
        <Metric label="最低" value={fixed(props.quote.low)} tone="down" />
        <Metric label="昨收" value={fixed(props.quote.prevClose)} />
        <Metric label="换手" value={percent(props.quote.turnoverRate)} />
        <Metric label="量比" value={fixed(volumeRatio())} />
        <Metric label="振幅" value={percent(props.quote.amplitude)} />
        <Metric label="均价" value={fixed(props.quote.avgPrice)} />
        <Metric label="涨停" value={fixed(limits().up)} tone="up" />
        <Metric label="跌停" value={fixed(limits().down)} tone="down" />
        <Metric label="成交量" value={compactVolume(props.quote.volume)} />
        <Metric label="成交额" value={compactAmount(props.quote.amount)} />
      </div>
    </section>
  )
}

function limitPrices(quote: Quote): { up?: number; down?: number } {
  if (quote.limitUp !== undefined && quote.limitDown !== undefined) {
    return { up: quote.limitUp, down: quote.limitDown }
  }
  if (!(quote.prevClose > 0)) return {}
  const limitPct = quote.name.toUpperCase().includes('ST')
    ? 5
    : quote.market === 'BJ'
      ? 30
      : /^(300|301|302|688|689)/.test(quote.symbol)
        ? 20
        : 10
  return {
    up: roundPrice(quote.prevClose * (1 + limitPct / 100)),
    down: roundPrice(quote.prevClose * (1 - limitPct / 100))
  }
}

function roundPrice(value: number): number {
  return Math.round(value * 100) / 100
}

function percent(value: number | undefined): string {
  return value === undefined ? '—' : `${value.toFixed(2)}%`
}

interface MetricProps {
  label: string
  value: string
  tone?: Tone
}

function Metric(props: MetricProps): JSX.Element {
  return (
    <div class="metric">
      <span class="metric__label">{props.label}</span>
      <span class="metric__value num" classList={{ [props.tone ?? 'flat']: !!props.tone }}>
        {props.value}
      </span>
    </div>
  )
}
