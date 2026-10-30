/**
 * 沪深异动（MAC 0x1237）。
 *
 * 每行来自 MAC 异动快照；点击行切到该股票。
 * 数据按时间倒序，收盘后显示当日最后快照。
 */
import { createSignal, For, onMount, Show, type JSX } from 'solid-js'
import type { MacUnusualItem } from '@shared/types'
import { api, errorMessage } from '../lib/ipc'
import { IconClose, IconRefresh } from './Icons'

const LIMIT = 360

export function UnusualPanel(props: {
  onClose: () => void
  onSelect: (code: string) => void
}): JSX.Element {
  const [items, setItems] = createSignal<MacUnusualItem[]>([])
  const [loading, setLoading] = createSignal(true)
  const [error, setError] = createSignal<string | null>(null)

  const load = async (): Promise<void> => {
    setLoading(true)
    try {
      setItems((await api.mac.unusual(600)).slice(0, LIMIT))
      setError(null)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setLoading(false)
    }
  }

  onMount(() => void load())

  return (
    <div class="unusual-backdrop" onClick={() => props.onClose()}>
      <section
        class="unusual-panel"
        role="dialog"
        aria-modal="true"
        aria-label="沪深异动"
        onClick={(event) => event.stopPropagation()}
      >
        <header class="unusual__head">
          <div>
            <div class="unusual__eyebrow">MAC 0x1237 · 沪深合并 · 时间倒序</div>
            <h2 class="unusual__title">沪深异动</h2>
          </div>
          <div class="unusual__actions">
            <span>{items().length} 条</span>
            <button
              class="btn btn--icon btn--bare unusual-refresh"
              title="刷新异动"
              onClick={() => void load()}
            >
              <IconRefresh size={14} />
            </button>
            <button
              class="btn btn--icon btn--bare"
              title="关闭异动"
              onClick={() => props.onClose()}
            >
              <IconClose size={16} />
            </button>
          </div>
        </header>

        <Show when={error()}>{(message) => <div class="unusual__error">{message()}</div>}</Show>

        <div class="unusual__table-wrap">
          <table class="unusual__table">
            <thead>
              <tr>
                <th>时间</th>
                <th>代码</th>
                <th>名称</th>
                <th>异动</th>
                <th class="unusual__num">数值</th>
              </tr>
            </thead>
            <tbody>
              <For each={items()}>
                {(item) => (
                  <tr onClick={() => props.onSelect(item.code)}>
                    <td class="num">{item.time}</td>
                    <td class="num">{item.code.toUpperCase()}</td>
                    <td>{item.name}</td>
                    <td class="unusual__desc">{item.desc}</td>
                    <td class="unusual__num num">{item.value || '—'}</td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
          <Show when={loading()}>
            <div class="unusual__loading">加载异动快照…</div>
          </Show>
          <Show when={!loading() && items().length === 0}>
            <div class="unusual__loading">暂无异动</div>
          </Show>
        </div>
      </section>
    </div>
  )
}
