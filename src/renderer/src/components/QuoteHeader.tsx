/**
 * 个股行情头部：名称、代码、最新价、涨跌，以及一排核心指标。
 */
import { type JSX } from 'solid-js'
import { MARKET_LABEL, type Quote } from '@shared/types'
import { compactAmount, compactVolume, fixed, signed, signedPct, timeOfDay } from '@shared/format'
import { createValueFlash } from '../lib/dom'
import { toneOf, type Tone } from '../lib/tone'
import { addWatchItem, removeWatchItem, watchItemOf } from '../stores/app'
import { IconStar, IconStarFilled } from './Icons'

export interface QuoteHeaderProps {
  quote: Quote
}

export function QuoteHeader(props: QuoteHeaderProps): JSX.Element {
  const tone = (): Tone => toneOf(props.quote.changePct)
  const flash = createValueFlash(() => props.quote.price)

  const inWatchlist = (): boolean => watchItemOf(props.quote.code) !== undefined

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
          </div>

          <div class="quote-header__code num">
            {props.quote.code.toUpperCase()} · {props.quote.currency} · 行情时间{' '}
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
        <Metric label="成交量" value={compactVolume(props.quote.volume)} />
        <Metric label="成交额" value={compactAmount(props.quote.amount)} />
      </div>
    </section>
  )
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
