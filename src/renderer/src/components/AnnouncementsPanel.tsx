/**
 * 7615 TQLEX 在线公告：只展示标题/日期/类型/来源，点击标题用系统浏览器打开 PDF。
 *
 * 和 7709 的 F10 文本是两条数据通路；不抓取研报正文，也不绕过任何授权。
 */
import { createSignal, For, onCleanup, onMount, Show, type JSX } from 'solid-js'
import type { F10Announcement } from '@shared/types'
import { api, errorMessage } from '../lib/ipc'
import { IconClose } from './Icons'

interface AnnouncementsPanelProps {
  code: string
  name: string
  onClose: () => void
}

export function AnnouncementsPanel(props: AnnouncementsPanelProps): JSX.Element {
  const [rows, setRows] = createSignal<F10Announcement[]>([])
  const [loading, setLoading] = createSignal(true)
  const [error, setError] = createSignal<string | null>(null)
  let requestId = 0

  const load = async (): Promise<void> => {
    const current = ++requestId
    setLoading(true)
    setError(null)
    try {
      const data = await api.f10.announcements(props.code)
      if (current !== requestId) return
      setRows(data)
    } catch (cause) {
      if (current === requestId) setError(errorMessage(cause))
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
    void load()
  })

  return (
    <div class="announcements-backdrop" onClick={() => props.onClose()}>
      <section
        class="announcements"
        role="dialog"
        aria-modal="true"
        aria-label={`${props.name} 在线公告`}
        onClick={(event) => event.stopPropagation()}
      >
        <header class="announcements__head">
          <div>
            <div class="announcements__eyebrow">7615 TQLEX · 在线公告</div>
            <h2 class="announcements__title">
              {props.name} <code>{props.code.toUpperCase()}</code>
            </h2>
          </div>
          <button class="btn btn--icon btn--bare" title="关闭公告" onClick={() => props.onClose()}>
            <IconClose size={16} />
          </button>
        </header>

        <div class="announcements__body">
          <Show when={!loading()} fallback={<div class="announcements__empty">加载公告…</div>}>
            <Show when={!error()} fallback={<div class="announcements__error">{error()}</div>}>
              <Show
                when={rows().length > 0}
                fallback={<div class="announcements__empty">暂无公告</div>}
              >
                <div class="announcements__meta">共 {rows().length} 条 · 点击标题打开原文</div>
                <div class="announcements__list">
                  <div class="announcement-row announcement-row--head">
                    <span>日期</span>
                    <span>标题</span>
                    <span>类型</span>
                    <span>来源</span>
                  </div>
                  <For each={rows()}>
                    {(row) => (
                      <div class="announcement-row">
                        <span class="announcement-row__date num">{row.date}</span>
                        <button
                          class="announcement-row__title"
                          title={row.url || row.title}
                          disabled={!row.url}
                          onClick={() => void api.app.openExternal(row.url)}
                        >
                          {row.title}
                        </button>
                        <span class="announcement-row__type">{row.type}</span>
                        <span class="announcement-row__source">{row.source}</span>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            </Show>
          </Show>
        </div>

        <footer class="announcements__foot">
          <span>数据来自通达信 7615 免费公告网关</span>
          <span>PDF 由系统浏览器打开</span>
        </footer>
      </section>
    </div>
  )
}
