/**
 * 自选股单行：名称 / 代码 / 最新价 / 涨跌幅，价格跳变时闪一下。
 */
import { type JSX } from 'solid-js'
import type { Quote, WatchItem } from '@shared/types'
import { fixed, signedPct } from '@shared/format'
import { createValueFlash } from '../lib/dom'
import { toneOf, type Tone } from '../lib/tone'
import { appState, removeWatchItem, setActiveCode } from '../stores/app'
import { quoteOf } from '../stores/quotes'
import { IconClose } from './Icons'

export interface WatchRowProps {
  item: WatchItem
}

export function WatchRow(props: WatchRowProps): JSX.Element {
  const quote = (): Quote | undefined => quoteOf(props.item.code)
  const tone = (): Tone => toneOf(quote()?.changePct)
  const flash = createValueFlash(() => quote()?.price)
  const active = (): boolean => appState.activeCode === props.item.code

  return (
    <button
      class="watch-row"
      classList={{ 'watch-row--active': active() }}
      onClick={() => setActiveCode(props.item.code)}
      title={`${props.item.name} ${props.item.code.toUpperCase()}`}
    >
      <div class="watch-row__main">
        <div class="watch-row__name">{quote()?.name || props.item.name}</div>
        <div class="watch-row__code num">{props.item.code.toUpperCase()}</div>
      </div>

      <div class="watch-row__side">
        <div class="watch-row__nums">
          <div
            class="watch-row__price num"
            classList={{
              [tone()]: true,
              'watch-row__price--up': flash() === 'up',
              'watch-row__price--down': flash() === 'down'
            }}
          >
            {fixed(quote()?.price)}
          </div>
          <div class="watch-row__chg num" classList={{ [tone()]: true }}>
            {signedPct(quote()?.changePct)}
          </div>
        </div>

        <span
          class="watch-row__remove"
          role="button"
          aria-label="移出自选"
          title="移出自选"
          onClick={(event) => {
            event.stopPropagation()
            removeWatchItem(props.item.code)
          }}
        >
          <IconClose size={11} />
        </span>
      </div>
    </button>
  )
}
