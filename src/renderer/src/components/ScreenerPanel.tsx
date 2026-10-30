/**
 * 条件选股：全市场扫描价格/涨幅/成交额/换手/振幅。
 *
 * 扫描由 Python 后端翻页拉取 0x054b；这里只负责条件输入与结果表格。
 * 不做未来函数、不生成交易指令。
 */
import { createSignal, For, Show, type JSX } from 'solid-js'
import type { CategoryQuote, ScreenResult, ScreenSortBy } from '@shared/types'
import { compactAmount, fixed, signedPct, thousands } from '@shared/format'
import { api, errorMessage } from '../lib/ipc'
import { IconClose } from './Icons'

interface ScreenerPanelProps {
  onClose: () => void
  onSelect: (quote: CategoryQuote) => void
}

const SORTS: Array<{ value: ScreenSortBy; label: string }> = [
  { value: 'changePct', label: '涨幅' },
  { value: 'amount', label: '成交额' },
  { value: 'turnoverRate', label: '换手率' },
  { value: 'amplitude', label: '振幅' }
]

function numberOrUndefined(value: string): number | undefined {
  const text = value.trim()
  if (!text) return undefined
  const parsed = Number(text)
  return Number.isFinite(parsed) ? parsed : undefined
}

export function ScreenerPanel(props: ScreenerPanelProps): JSX.Element {
  const [minChange, setMinChange] = createSignal('3')
  const [minAmountYi, setMinAmountYi] = createSignal('1')
  const [minTurnover, setMinTurnover] = createSignal('')
  const [minAmplitude, setMinAmplitude] = createSignal('')
  const [maxPrice, setMaxPrice] = createSignal('')
  const [sortBy, setSortBy] = createSignal<ScreenSortBy>('changePct')
  const [result, setResult] = createSignal<ScreenResult | null>(null)
  const [loading, setLoading] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  const [industry, setIndustry] = createSignal('')

  const run = async (): Promise<void> => {
    if (loading()) return
    setLoading(true)
    setError(null)
    try {
      const amountYi = numberOrUndefined(minAmountYi())
      const data = await api.screen.run({
        minChangePct: numberOrUndefined(minChange()),
        minAmount: amountYi === undefined ? undefined : amountYi * 100_000_000,
        minTurnoverRate: numberOrUndefined(minTurnover()),
        minAmplitude: numberOrUndefined(minAmplitude()),
        maxPrice: numberOrUndefined(maxPrice()),
        industry: industry().trim() || undefined,
        sortBy: sortBy(),
        limit: 100
      })
      setResult(data)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div class="screener-backdrop" onClick={() => props.onClose()}>
      <section
        class="screener"
        role="dialog"
        aria-modal="true"
        aria-label="条件选股"
        onClick={(event) => event.stopPropagation()}
      >
        <header class="screener__head">
          <div>
            <div class="screener__eyebrow">全市场 · 0x054b · 本地条件</div>
            <h2 class="screener__title">条件选股</h2>
          </div>
          <button class="btn btn--icon btn--bare" title="关闭选股" onClick={() => props.onClose()}>
            <IconClose size={16} />
          </button>
        </header>

        <div class="screener__filters">
          <label class="screener__field">
            <span>涨幅 ≥</span>
            <input
              type="number"
              step="0.1"
              value={minChange()}
              onInput={(event) => setMinChange(event.currentTarget.value)}
            />
            <em>%</em>
          </label>
          <label class="screener__field">
            <span>成交额 ≥</span>
            <input
              type="number"
              step="0.1"
              value={minAmountYi()}
              onInput={(event) => setMinAmountYi(event.currentTarget.value)}
            />
            <em>亿</em>
          </label>
          <label class="screener__field">
            <span>换手 ≥</span>
            <input
              type="number"
              step="0.1"
              value={minTurnover()}
              onInput={(event) => setMinTurnover(event.currentTarget.value)}
            />
            <em>%</em>
          </label>
          <label class="screener__field">
            <span>振幅 ≥</span>
            <input
              type="number"
              step="0.1"
              value={minAmplitude()}
              onInput={(event) => setMinAmplitude(event.currentTarget.value)}
            />
            <em>%</em>
          </label>
          <label class="screener__field">
            <span>价格 ≤</span>
            <input
              type="number"
              step="0.1"
              value={maxPrice()}
              onInput={(event) => setMaxPrice(event.currentTarget.value)}
            />
            <em>元</em>
          </label>
          <label class="screener__field">
            <span>行业</span>
            <input
              type="text"
              placeholder="如 银行"
              value={industry()}
              onInput={(event) => setIndustry(event.currentTarget.value)}
            />
          </label>
          <label class="screener__field screener__field--sort">
            <span>排序</span>
            <select
              value={sortBy()}
              onChange={(event) => setSortBy(event.currentTarget.value as ScreenSortBy)}
            >
              <For each={SORTS}>{(item) => <option value={item.value}>{item.label}</option>}</For>
            </select>
          </label>
          <button
            class="btn btn--primary screener__run"
            disabled={loading()}
            onClick={() => void run()}
          >
            {loading() ? '扫描全市场…' : '开始筛选'}
          </button>
        </div>

        <Show when={error()}>
          {(message) => (
            <div class="screener__error" role="alert">
              {message()}
            </div>
          )}
        </Show>

        <div class="screener__summary">
          <Show
            when={result()}
            fallback={<span>设置条件后点击「开始筛选」；全市场约 5,500 只。</span>}
          >
            {(data) => (
              <>
                <span>
                  扫描 {thousands(data().scanned)} 只 · 命中 {thousands(data().matched)} 只
                </span>
                <span>
                  {new Date(data().generatedAt).toLocaleTimeString('zh-CN')} · 最多显示 100 条
                </span>
              </>
            )}
          </Show>
        </div>

        <div class="screener__table-wrap">
          <Show when={result()} fallback={<div class="screener__empty">结果会显示在这里</div>}>
            {(data) => (
              <table class="screener__table">
                <thead>
                  <tr>
                    <th>代码 / 名称</th>
                    <th class="num">现价</th>
                    <th class="num">涨幅</th>
                    <th class="num">成交额</th>
                    <th class="num">换手</th>
                    <th class="num">振幅</th>
                  </tr>
                </thead>
                <tbody>
                  <For each={data().quotes}>
                    {(quote) => (
                      <tr class="screener__row" onClick={() => props.onSelect(quote)}>
                        <td>
                          <div class="screener__name">{quote.name}</div>
                          <div class="screener__code num">{quote.code.toUpperCase()}</div>
                        </td>
                        <td class="num">{fixed(quote.price)}</td>
                        <td
                          class="num"
                          classList={{
                            'tone-up': quote.changePct > 0,
                            'tone-down': quote.changePct < 0
                          }}
                        >
                          {signedPct(quote.changePct)}
                        </td>
                        <td class="num">{compactAmount(quote.amount)}</td>
                        <td class="num">
                          {quote.turnoverRate === undefined ? '—' : `${fixed(quote.turnoverRate)}%`}
                        </td>
                        <td class="num">
                          {quote.amplitude === undefined ? '—' : `${fixed(quote.amplitude)}%`}
                        </td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            )}
          </Show>
        </div>

        <footer class="screener__foot">
          <span>数据源：通达信 7709 · 0x054b · 全市场扫描</span>
          <span>仅筛选，不生成交易指令；扫描结果缓存 60 秒</span>
        </footer>
      </section>
    </div>
  )
}
