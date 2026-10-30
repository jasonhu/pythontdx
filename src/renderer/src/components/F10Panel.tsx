/**
 * F10 公司资料（0x02cf 目录 + 0x02d0 正文）。
 *
 * 左侧段落目录，右侧 GBK 文本；段落按需加载并缓存，关闭即释放。
 */
import { createSignal, For, onCleanup, onMount, Show, type JSX } from 'solid-js'
import type { F10Section } from '@shared/types'
import { api, errorMessage } from '../lib/ipc'
import { IconClose } from './Icons'

interface F10PanelProps {
  code: string
  name: string
  onClose: () => void
}

export function F10Panel(props: F10PanelProps): JSX.Element {
  const [sections, setSections] = createSignal<F10Section[]>([])
  const [active, setActive] = createSignal<F10Section | null>(null)
  const [text, setText] = createSignal('')
  const [loading, setLoading] = createSignal(true)
  const [error, setError] = createSignal<string | null>(null)
  const cache = new Map<string, string>()
  let requestId = 0

  const openSection = async (section: F10Section): Promise<void> => {
    const current = ++requestId
    setActive(section)
    setLoading(true)
    try {
      const cached = cache.get(section.name)
      const content = cached ?? (await api.f10.content(props.code, section))
      if (current !== requestId) return
      cache.set(section.name, content)
      setText(content)
      setError(null)
    } catch (cause) {
      if (current !== requestId) return
      setError(errorMessage(cause))
      setText('')
    } finally {
      if (current === requestId) setLoading(false)
    }
  }

  onMount(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') props.onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    onCleanup(() => window.removeEventListener('keydown', onKeyDown))

    void (async () => {
      try {
        const catalog = await api.f10.catalog(props.code)
        setSections(catalog)
        if (catalog[0]) await openSection(catalog[0])
        else setLoading(false)
      } catch (cause) {
        setError(errorMessage(cause))
        setLoading(false)
      }
    })()
  })

  return (
    <div class="f10-backdrop" onClick={() => props.onClose()}>
      <section
        class="f10"
        role="dialog"
        aria-modal="true"
        aria-label={`${props.name} F10 公司资料`}
        onClick={(event) => event.stopPropagation()}
      >
        <header class="f10__head">
          <div>
            <div class="f10__eyebrow">{props.code.toUpperCase()} · 通达信 F10</div>
            <h2 class="f10__title">{props.name} · 公司资料</h2>
          </div>
          <button class="btn btn--icon btn--bare" title="关闭 F10" onClick={() => props.onClose()}>
            <IconClose size={16} />
          </button>
        </header>

        <div class="f10__body">
          <aside class="f10__nav" aria-label="F10 段落目录">
            <For each={sections()}>
              {(section) => (
                <button
                  class="f10__nav-item"
                  classList={{ 'f10__nav-item--active': section.name === active()?.name }}
                  onClick={() => void openSection(section)}
                >
                  {section.name}
                </button>
              )}
            </For>
            <Show when={sections().length === 0 && !error()}>
              <span class="f10__nav-empty">目录加载中…</span>
            </Show>
          </aside>

          <div class="f10__content">
            <Show when={error()}>
              {(message) => (
                <div class="f10__error" role="alert">
                  {message()}
                </div>
              )}
            </Show>
            <Show when={loading()}>
              <div class="f10__loading">加载中…</div>
            </Show>
            <pre class="f10__text">{text()}</pre>
          </div>
        </div>

        <footer class="f10__foot">
          <span>数据源：7709 · 0x02cf / 0x02d0</span>
          <span>GBK 文本，按主站原文展示</span>
        </footer>
      </section>
    </div>
  )
}
