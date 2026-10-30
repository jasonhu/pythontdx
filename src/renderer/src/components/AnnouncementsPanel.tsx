/**
 * 7615 TQLEX 在线资料：公告列表 + 公司概况。
 *
 * 只调用免费 HTTP 网关；公告详情交系统浏览器，不抓取研报正文，也不绕过授权。
 */
import { createSignal, For, Match, onCleanup, onMount, Show, Switch, type JSX } from 'solid-js'
import type { F10Announcement, F10ProfileTable } from '@shared/types'
import { api, errorMessage } from '../lib/ipc'
import { IconClose } from './Icons'

interface AnnouncementsPanelProps {
  code: string
  name: string
  onClose: () => void
}

type OnlineTab = 'announcements' | 'profile' | 'valuation' | 'finance'

export function AnnouncementsPanel(props: AnnouncementsPanelProps): JSX.Element {
  const [tab, setTab] = createSignal<OnlineTab>('announcements')
  const [rows, setRows] = createSignal<F10Announcement[]>([])
  const [loading, setLoading] = createSignal(true)
  const [error, setError] = createSignal<string | null>(null)
  const [profile, setProfile] = createSignal<F10ProfileTable | null>(null)
  const [profileLoading, setProfileLoading] = createSignal(true)
  const [profileError, setProfileError] = createSignal<string | null>(null)
  const [valuation, setValuation] = createSignal<F10ProfileTable | null>(null)
  const [valuationLoading, setValuationLoading] = createSignal(true)
  const [valuationError, setValuationError] = createSignal<string | null>(null)
  const [finance, setFinance] = createSignal<F10ProfileTable | null>(null)
  const [financeLoading, setFinanceLoading] = createSignal(true)
  const [financeError, setFinanceError] = createSignal<string | null>(null)
  let requestId = 0

  const loadAnnouncements = async (): Promise<void> => {
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

  const loadProfile = async (): Promise<void> => {
    setProfileLoading(true)
    setProfileError(null)
    try {
      setProfile(await api.f10.profile(props.code))
    } catch (cause) {
      setProfileError(errorMessage(cause))
    } finally {
      setProfileLoading(false)
    }
  }

  const loadValuation = async (): Promise<void> => {
    setValuationLoading(true)
    setValuationError(null)
    try {
      setValuation(await api.f10.valuation(props.code))
    } catch (cause) {
      setValuationError(errorMessage(cause))
    } finally {
      setValuationLoading(false)
    }
  }

  const loadFinance = async (): Promise<void> => {
    setFinanceLoading(true)
    setFinanceError(null)
    try {
      setFinance(await api.f10.finance(props.code))
    } catch (cause) {
      setFinanceError(errorMessage(cause))
    } finally {
      setFinanceLoading(false)
    }
  }

  onMount(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') props.onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    onCleanup(() => window.removeEventListener('keydown', onKeyDown))
    void loadAnnouncements()
    void loadProfile()
    void loadValuation()
    void loadFinance()
  })

  const cell = (value: string | number | null | undefined): string =>
    value === null || value === undefined || value === '' ? '—' : String(value)

  return (
    <div class="announcements-backdrop" onClick={() => props.onClose()}>
      <section
        class="announcements"
        role="dialog"
        aria-modal="true"
        aria-label={`${props.name} 在线资料`}
        onClick={(event) => event.stopPropagation()}
      >
        <header class="announcements__head">
          <div>
            <div class="announcements__eyebrow">7615 TQLEX · 在线资料</div>
            <h2 class="announcements__title">
              {props.name} <code>{props.code.toUpperCase()}</code>
            </h2>
          </div>
          <button
            class="btn btn--icon btn--bare"
            title="关闭在线资料"
            onClick={() => props.onClose()}
          >
            <IconClose size={16} />
          </button>
        </header>

        <div class="online-tabs">
          <button
            class="online-tab"
            data-active={tab() === 'announcements'}
            onClick={() => setTab('announcements')}
          >
            公告
          </button>
          <button
            class="online-tab online-profile-tab"
            data-active={tab() === 'profile'}
            onClick={() => setTab('profile')}
          >
            公司概况
          </button>
          <button
            class="online-tab online-valuation-tab"
            data-active={tab() === 'valuation'}
            onClick={() => setTab('valuation')}
          >
            估值
          </button>
          <button
            class="online-tab online-finance-tab"
            data-active={tab() === 'finance'}
            onClick={() => setTab('finance')}
          >
            财务
          </button>
        </div>

        <div class="announcements__body">
          <Switch>
            <Match when={tab() === 'announcements'}>
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
            </Match>

            <Match when={tab() === 'profile'}>
              <Show
                when={!profileLoading()}
                fallback={<div class="announcements__empty">加载公司概况…</div>}
              >
                <Show
                  when={!profileError()}
                  fallback={<div class="announcements__error">{profileError()}</div>}
                >
                  <Show
                    when={profile()}
                    fallback={<div class="announcements__empty">暂无概况</div>}
                  >
                    {(table) => (
                      <div class="profile-grid">
                        <For each={table().columns}>
                          {(column, index) => (
                            <div class="profile-cell">
                              <span>{column}</span>
                              <strong>{cell(table().rows[0]?.[index()])}</strong>
                            </div>
                          )}
                        </For>
                      </div>
                    )}
                  </Show>
                </Show>
              </Show>
            </Match>

            <Match when={tab() === 'valuation'}>
              <Show
                when={!valuationLoading()}
                fallback={<div class="announcements__empty">加载估值…</div>}
              >
                <Show
                  when={!valuationError()}
                  fallback={<div class="announcements__error">{valuationError()}</div>}
                >
                  <Show
                    when={valuation()}
                    fallback={<div class="announcements__empty">暂无估值</div>}
                  >
                    {(table) => (
                      <div class="valuation-table-wrap">
                        <table class="valuation-table">
                          <thead>
                            <tr>
                              <For each={table().columns}>{(column) => <th>{column}</th>}</For>
                            </tr>
                          </thead>
                          <tbody>
                            <For each={table().rows}>
                              {(row) => (
                                <tr>
                                  <For each={row}>
                                    {(value) => <td class="num">{cell(value)}</td>}
                                  </For>
                                </tr>
                              )}
                            </For>
                          </tbody>
                        </table>
                      </div>
                    )}
                  </Show>
                </Show>
              </Show>
            </Match>

            <Match when={tab() === 'finance'}>
              <Show
                when={!financeLoading()}
                fallback={<div class="announcements__empty">加载财务指标…</div>}
              >
                <Show
                  when={!financeError()}
                  fallback={<div class="announcements__error">{financeError()}</div>}
                >
                  <Show
                    when={finance()}
                    fallback={<div class="announcements__empty">暂无财务指标</div>}
                  >
                    {(table) => (
                      <div class="valuation-table-wrap">
                        <table class="valuation-table finance-table">
                          <thead>
                            <tr>
                              <For each={table().columns}>{(column) => <th>{column}</th>}</For>
                            </tr>
                          </thead>
                          <tbody>
                            <For each={table().rows}>
                              {(row) => (
                                <tr>
                                  <For each={row}>
                                    {(value) => <td class="num">{cell(value)}</td>}
                                  </For>
                                </tr>
                              )}
                            </For>
                          </tbody>
                        </table>
                      </div>
                    )}
                  </Show>
                </Show>
              </Show>
            </Match>
          </Switch>
        </div>

        <footer class="announcements__foot">
          <span>数据来自通达信 7615 免费资料网关</span>
          <span>PDF 由系统浏览器打开</span>
        </footer>
      </section>
    </div>
  )
}
