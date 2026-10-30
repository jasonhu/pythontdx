/**
 * 公式预览：对当前股票的日 K 求值一条安全表达式，并与收盘价叠加显示。
 *
 * 只支持少量技术指标函数；不是完整通达信公式语言，也不执行任意代码。
 */
import { createEffect, createMemo, createSignal, For, Show, type JSX } from 'solid-js'
import type { KLineBar } from '@shared/types'
import { fixed, signedPct } from '@shared/format'
import {
  backtestFormula,
  evaluateFormula,
  type FormulaBacktest,
  type FormulaResult
} from '@shared/formula'
import { activeItems, appState, removeFormula, saveFormula } from '../stores/app'
import { api, errorMessage } from '../lib/ipc'
import { IconClose } from './Icons'

interface FormulaPanelProps {
  code: string
  name: string
  onClose: () => void
  onSelect: (code: string) => void
}

const EXAMPLES = [
  'MA(CLOSE,5)',
  'MA(CLOSE,20)',
  'EMA(CLOSE,12)-EMA(CLOSE,26)',
  '(HIGH+LOW)/2',
  'CROSS(CLOSE,MA(CLOSE,20))'
]

const WIDTH = 900
const HEIGHT = 300
const PAD = 18

function linePath(values: number[], min: number, max: number): string {
  const span = max - min || 1
  let path = ''
  let pen = false
  values.forEach((value, index) => {
    const x = PAD + (index / Math.max(1, values.length - 1)) * (WIDTH - PAD * 2)
    const y = HEIGHT - PAD - ((value - min) / span) * (HEIGHT - PAD * 2)
    if (!Number.isFinite(value)) {
      pen = false
      return
    }
    path += `${pen ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)} `
    pen = true
  })
  return path.trim()
}

export function FormulaPanel(props: FormulaPanelProps): JSX.Element {
  const [bars, setBars] = createSignal<KLineBar[]>([])
  const [expression, setExpression] = createSignal('MA(CLOSE,20)')
  const [formulaName, setFormulaName] = createSignal('')
  const [result, setResult] = createSignal<FormulaResult | null>(null)
  const [backtest, setBacktest] = createSignal<FormulaBacktest | null>(null)
  const [loading, setLoading] = createSignal(true)
  const [error, setError] = createSignal<string | null>(null)
  const [scanning, setScanning] = createSignal(false)
  const [scanResults, setScanResults] = createSignal<
    Array<{ code: string; name: string; latest: number }>
  >([])
  const [scanError, setScanError] = createSignal<string | null>(null)
  const [scanned, setScanned] = createSignal(false)
  let requestId = 0

  const calculate = (data: KLineBar[]): void => {
    try {
      const next = evaluateFormula(expression(), data)
      setResult(next)
      setBacktest(backtestFormula(next, data))
      setError(null)
    } catch (cause) {
      setResult(null)
      setBacktest(null)
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const run = (): void => {
    calculate(bars())
  }

  const save = (): void => {
    if (!expression().trim()) return
    saveFormula(formulaName(), expression())
    setFormulaName('')
  }

  const scanWatchlist = async (): Promise<void> => {
    if (scanning()) return
    setScanning(true)
    setScanError(null)
    setScanned(false)
    const matches: Array<{ code: string; name: string; latest: number }> = []
    try {
      for (const item of activeItems().slice(0, 20)) {
        try {
          const series = await api.trend.kline({ code: item.code, period: 'day', count: 120 })
          const evaluated = evaluateFormula(expression(), series.bars)
          if (evaluated.latest !== null && evaluated.latest > 0) {
            matches.push({ code: item.code, name: item.name, latest: evaluated.latest })
          }
        } catch {
          // 单只失败不影响其余自选
        }
      }
      setScanResults(matches)
      setScanned(true)
    } catch (cause) {
      setScanError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setScanning(false)
    }
  }

  const load = async (): Promise<void> => {
    const current = ++requestId
    setLoading(true)
    setError(null)
    try {
      const series = await api.trend.kline({ code: props.code, period: 'day', count: 320 })
      if (current !== requestId) return
      setBars(series.bars)
      calculate(series.bars)
    } catch (cause) {
      if (current === requestId) setError(errorMessage(cause))
    } finally {
      if (current === requestId) setLoading(false)
    }
  }

  createEffect(() => {
    if (!props.code) return
    void load()
  })

  const chart = createMemo(() => {
    const data = bars()
    const formula = result()
    if (data.length === 0) return { close: '', formula: '' }
    const all = [...data.map((bar) => bar.close), ...(formula?.values ?? [])].filter((value) =>
      Number.isFinite(value)
    )
    if (all.length === 0) return { close: '', formula: '' }
    const min = Math.min(...all)
    const max = Math.max(...all)
    return {
      close: linePath(
        data.map((bar) => bar.close),
        min,
        max
      ),
      formula: formula ? linePath(formula.values, min, max) : ''
    }
  })

  const latestBar = createMemo(() => bars()[bars().length - 1])
  const latestChange = createMemo(() => {
    const bars_ = bars()
    const last = bars_[bars_.length - 1]
    const previous = bars_[bars_.length - 2]
    if (!last || !previous || previous.close === 0) return 0
    return ((last.close - previous.close) / previous.close) * 100
  })

  return (
    <div class="formula-backdrop" onClick={() => props.onClose()}>
      <section
        class="formula-panel"
        role="dialog"
        aria-modal="true"
        aria-label="公式预览"
        onClick={(event) => event.stopPropagation()}
      >
        <header class="formula__head">
          <div>
            <div class="formula__eyebrow">安全表达式 · MA/EMA/REF/CROSS</div>
            <h2 class="formula__title">
              {props.name} <code>{props.code.toUpperCase()}</code>
            </h2>
          </div>
          <button class="btn btn--icon btn--bare" title="关闭公式" onClick={() => props.onClose()}>
            <IconClose size={16} />
          </button>
        </header>

        <div class="formula__form">
          <input
            class="formula__input"
            value={expression()}
            aria-label="指标公式"
            placeholder="例如 MA(CLOSE,20)"
            onInput={(event) => setExpression(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') run()
            }}
          />
          <button class="btn btn--primary formula__run" disabled={loading()} onClick={run}>
            计算
          </button>
        </div>

        <div class="formula__examples">
          <For each={EXAMPLES}>
            {(example) => (
              <button
                class="formula__example"
                onClick={() => {
                  setExpression(example)
                  run()
                }}
              >
                {example}
              </button>
            )}
          </For>
        </div>

        <div class="formula__savebar">
          <input
            class="formula__name"
            placeholder="保存为…（留空用表达式）"
            value={formulaName()}
            onInput={(event) => setFormulaName(event.currentTarget.value)}
          />
          <button
            class="btn formula__scan"
            disabled={scanning() || loading()}
            onClick={() => void scanWatchlist()}
          >
            {scanning() ? '筛选中…' : '筛选自选'}
          </button>
          <button class="btn formula__save" onClick={save}>
            保存公式
          </button>
        </div>

        <Show when={scanError()}>{(message) => <div class="formula__error">{message()}</div>}</Show>
        <Show when={scanned()}>
          <div class="formula__matches">
            <span>自选池匹配 {scanResults().length} 只</span>
            <For each={scanResults()}>
              {(match) => (
                <button
                  class="formula__match"
                  onClick={() => {
                    props.onSelect(match.code)
                    props.onClose()
                  }}
                >
                  {match.name} <code>{match.code.toUpperCase()}</code> {fixed(match.latest)}
                </button>
              )}
            </For>
          </div>
        </Show>

        <Show when={appState.formulas.length > 0}>
          <div class="formula__saved">
            <For each={appState.formulas}>
              {(item) => (
                <div class="formula__saved-item">
                  <button
                    class="formula__saved-apply"
                    onClick={() => {
                      setExpression(item.expression)
                      run()
                    }}
                  >
                    <span>{item.name}</span>
                    <code>{item.expression}</code>
                  </button>
                  <button
                    class="formula__saved-delete"
                    title="删除公式"
                    onClick={() => removeFormula(item.id)}
                  >
                    ×
                  </button>
                </div>
              )}
            </For>
          </div>
        </Show>

        <Show when={error()}>
          {(message) => (
            <div class="formula__error" role="alert">
              {message()}
            </div>
          )}
        </Show>

        <div class="formula__chart">
          <Show
            when={!loading() && bars().length > 0}
            fallback={<div class="formula__loading">{loading() ? '加载日 K…' : '没有数据'}</div>}
          >
            <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="公式曲线">
              <line
                x1={PAD}
                y1={HEIGHT - PAD}
                x2={WIDTH - PAD}
                y2={HEIGHT - PAD}
                class="formula__axis"
              />
              <path d={chart().close} class="formula__close" />
              <Show when={chart().formula}>
                <path d={chart().formula} class="formula__line" />
              </Show>
            </svg>
            <div class="formula__legend">
              <span class="formula__legend-close">收盘价</span>
              <span class="formula__legend-line">公式</span>
              <Show when={latestBar()}>
                {(last) => (
                  <span class="formula__latest">
                    {last().date} · 收盘 {fixed(last().close)} ·{' '}
                    <span
                      classList={{
                        'tone-up': latestChange() > 0,
                        'tone-down': latestChange() < 0
                      }}
                    >
                      {signedPct(latestChange())}
                    </span>
                    <Show when={result()}>
                      {(data) => (
                        <Show when={data().latest !== null}> · 公式 {fixed(data().latest!)}</Show>
                      )}
                    </Show>
                  </span>
                )}
              </Show>
            </div>
          </Show>
        </div>

        <Show when={backtest()}>
          {(data) => (
            <div class="formula__backtest">
              <span class="formula__backtest-title">单标的回测</span>
              <span>
                策略{' '}
                <span
                  classList={{
                    'tone-up': data().strategyReturn > 0,
                    'tone-down': data().strategyReturn < 0
                  }}
                >
                  {signedPct(data().strategyReturn)}
                </span>
              </span>
              <span>买入持有 {signedPct(data().holdReturn)}</span>
              <span>年化 {signedPct(data().annualizedReturn)}</span>
              <span>交易 {data().trades} 次</span>
              <span>胜率 {fixed(data().winRate)}%</span>
              <span>最大回撤 {fixed(data().maxDrawdown)}%</span>
            </div>
          )}
        </Show>

        <div class="formula__meta">
          <Show when={result()}>
            {(data) => (
              <>
                <span>最新 {data().latest === null ? '—' : fixed(data().latest!)}</span>
                <span>最小 {data().min === null ? '—' : fixed(data().min!)}</span>
                <span>最大 {data().max === null ? '—' : fixed(data().max!)}</span>
                <span>{bars().length} 根日 K</span>
              </>
            )}
          </Show>
        </div>

        <footer class="formula__foot">
          <span>仅支持 MA/EMA/REF/ABS/MAX/MIN/CROSS 与四则运算</span>
          <span>回测按上一根信号成交 · 手续费 0.03%</span>
        </footer>
      </section>
    </div>
  )
}
