/**
 * 板块行情（MAC 0x1231）。
 *
 * 行业/概念/风格/地域列表，含板块点位与领涨股；点击领涨股切当前行情。
 */
import { createEffect, createMemo, createSignal, For, Show, type JSX } from 'solid-js'
import type { MacBoard } from '@shared/types'
import { fixed, signedPct } from '@shared/format'
import { api, errorMessage } from '../lib/ipc'
import { IconClose } from './Icons'

const TABS: Array<{ type: number; label: string }> = [
  { type: 255, label: '全部' },
  // MAC 0x1231 的 0 表示一级行业、1 表示二级（细分）行业；早先只接了 0，
  // 345 个二级行业一直看不到（2026-11-01 实测 boardType=1 返回 345 条）。
  { type: 0, label: '一级行业' },
  { type: 1, label: '二级行业' },
  { type: 3, label: '概念' },
  { type: 4, label: '风格' },
  { type: 5, label: '地域' }
]

function pct(price: number, preClose: number): number {
  return preClose > 0 ? (price / preClose - 1) * 100 : 0
}

function leaderCode(board: MacBoard): string {
  const prefix = board.leaderMarket === 1 ? 'sh' : board.leaderMarket === 2 ? 'bj' : 'sz'
  return `${prefix}${board.leaderCode}`
}

export function BoardsPanel(props: {
  onClose: () => void
  onSelect: (code: string) => void
}): JSX.Element {
  const [type, setType] = createSignal(255)
  const [boards, setBoards] = createSignal<MacBoard[]>([])
  const [query, setQuery] = createSignal('')
  const [sort, setSort] = createSignal<'change' | 'changeAsc' | 'leader' | 'name'>('change')
  const [loading, setLoading] = createSignal(true)
  const [error, setError] = createSignal<string | null>(null)
  let requestId = 0

  const load = async (boardType: number): Promise<void> => {
    const current = ++requestId
    setLoading(true)
    setError(null)
    try {
      const data = await api.mac.boards(boardType)
      if (current !== requestId) return
      setBoards(data)
    } catch (cause) {
      if (current === requestId) setError(errorMessage(cause))
    } finally {
      if (current === requestId) setLoading(false)
    }
  }

  createEffect(() => void load(type()))

  const boardChange = (board: MacBoard): number => pct(board.price, board.preClose)

  const rows = createMemo(() => {
    const text = query().trim().toLowerCase()
    const mode = sort()
    const list = boards().filter(
      (board) =>
        board.price > 0 && board.preClose > 0 && (!text || board.name.toLowerCase().includes(text))
    )
    list.sort((a, b) => {
      if (mode === 'name') return a.name.localeCompare(b.name, 'zh-CN')
      if (mode === 'leader') {
        return pct(b.leaderPrice, b.leaderPreClose) - pct(a.leaderPrice, a.leaderPreClose)
      }
      if (mode === 'changeAsc') return boardChange(a) - boardChange(b)
      return boardChange(b) - boardChange(a)
    })
    return list.slice(0, 360)
  })

  return (
    <div class="boards-backdrop" onClick={() => props.onClose()}>
      <section
        class="boards-panel"
        role="dialog"
        aria-modal="true"
        aria-label="板块行情"
        onClick={(event) => event.stopPropagation()}
      >
        <header class="boards__head">
          <div>
            <div class="boards__eyebrow">MAC 0x1231 · 板块点位 + 领涨股</div>
            <h2 class="boards__title">板块行情</h2>
          </div>
          <div class="boards__actions">
            <span>{boards().length} 个板块</span>
            <button
              class="btn btn--icon btn--bare"
              title="关闭板块行情"
              onClick={() => props.onClose()}
            >
              <IconClose size={16} />
            </button>
          </div>
        </header>

        <div class="boards__tools">
          <div class="boards__tabs">
            <For each={TABS}>
              {(tab) => (
                <button
                  class={`boards__tab boards__tab--${tab.type}`}
                  data-active={type() === tab.type}
                  onClick={() => setType(tab.type)}
                >
                  {tab.label}
                </button>
              )}
            </For>
          </div>
          <input
            class="boards__search"
            type="search"
            placeholder="搜索板块"
            value={query()}
            onInput={(event) => setQuery(event.currentTarget.value)}
          />
        </div>

        <Show when={error()}>{(message) => <div class="boards__error">{message()}</div>}</Show>

        <div class="boards__table-wrap">
          <table class="boards__table">
            <thead>
              <tr>
                <th>
                  <button
                    class="boards__sort boards__sort--name"
                    data-active={sort() === 'name'}
                    onClick={() => setSort('name')}
                  >
                    板块
                  </button>
                </th>
                <th class="num">点位</th>
                <th class="num">
                  <button
                    class="boards__sort boards__sort--change"
                    data-active={sort() === 'change'}
                    onClick={() => setSort('change')}
                  >
                    涨跌幅 ↓
                  </button>
                  <button
                    class="boards__sort boards__sort--change-asc"
                    data-active={sort() === 'changeAsc'}
                    onClick={() => setSort('changeAsc')}
                  >
                    ↑
                  </button>
                </th>
                <th>领涨股</th>
                <th class="num">
                  <button
                    class="boards__sort boards__sort--leader"
                    data-active={sort() === 'leader'}
                    onClick={() => setSort('leader')}
                  >
                    领涨涨幅
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              <For each={rows()}>
                {(board) => {
                  const change = (): number => pct(board.price, board.preClose)
                  const leaderChange = (): number => pct(board.leaderPrice, board.leaderPreClose)
                  return (
                    <tr>
                      <td>{board.name}</td>
                      <td class="num">{fixed(board.price)}</td>
                      <td
                        class="num"
                        classList={{ 'tone-up': change() > 0, 'tone-down': change() < 0 }}
                      >
                        {signedPct(change())}
                      </td>
                      <td>
                        <button
                          class="boards__leader"
                          onClick={() => {
                            props.onSelect(leaderCode(board))
                            props.onClose()
                          }}
                        >
                          {board.leaderName || board.leaderCode}
                        </button>
                      </td>
                      <td
                        class="num"
                        classList={{
                          'tone-up': leaderChange() > 0,
                          'tone-down': leaderChange() < 0
                        }}
                      >
                        {signedPct(leaderChange())}
                      </td>
                    </tr>
                  )
                }}
              </For>
            </tbody>
          </table>
          <Show when={loading()}>
            <div class="boards__loading">加载板块行情…</div>
          </Show>
          <Show when={!loading() && rows().length === 0}>
            <div class="boards__loading">没有匹配板块</div>
          </Show>
        </div>
      </section>
    </div>
  )
}
