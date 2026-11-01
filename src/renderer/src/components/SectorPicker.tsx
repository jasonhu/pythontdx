/**
 * 板块选择器：在一个大窗口里按分类挑板块，再回左栏看该板块的个股排行。
 *
 * 为什么要有独立的大窗口：概念 269 个、风格 161 个、指数板块 117 个、一般 100 个、
 * 行业 111 个，塞进 240px 的左栏只能变成一条看不清的长列表（参考通达信的做法）。
 *
 * 数据来源：
 *   行业      → tdxhy.cfg（111 个通达信行业，带成分股）
 *   概念/风格/指数板块/一般 → block_*.dat（0x06b9 文件通道）
 *   自定义    → 自选分组（本应用里「自定义板块」就是分组）
 *
 * MAC 0x1231 的一级/二级行业只有板块点位与领涨股，**没有成分股通道**，
 * 所以这里不列它们——选了也变不出个股排行。
 */
import { createEffect, createMemo, createSignal, For, onMount, Show, type JSX } from 'solid-js'
import type { BlockKind, IndustryList } from '@shared/types'
import { appState } from '../stores/app'
import { api, errorMessage } from '../lib/ipc'
import { IconClose } from './Icons'

export interface SectorSelection {
  /** 稳定 key：`${kind}:${id}`，用于记住选中项 */
  key: string
  kind: 'industry' | BlockKind | 'custom'
  name: string
  codes: string[]
  names: Record<string, string>
  indexCode?: string
  /** 自定义板块对应的分组 id */
  groupId?: string
}

type CategoryKey = 'industry' | BlockKind | 'custom'

const CATEGORIES: Array<{ key: CategoryKey; label: string }> = [
  { key: 'industry', label: '行业' },
  { key: 'gn', label: '概念' },
  { key: 'fg', label: '风格' },
  { key: 'zs', label: '指数板块' },
  { key: 'general', label: '一般' },
  { key: 'custom', label: '自定义' }
]

type PickerBoard = {
  id: string
  name: string
  kind: 'industry' | BlockKind | 'custom'
  count: number
  codes: string[]
  names: Record<string, string>
  indexCode: string
}

interface SectorPickerProps {
  /** true 时只显示自定义板块（从「自定义」页签进来） */
  customOnly?: boolean
  onClose: () => void
  onPick: (selection: SectorSelection) => void
}

export function SectorPicker(props: SectorPickerProps): JSX.Element {
  // 只有「自定义」页签会以 customOnly 打开，初始分类跟着它走；
  // 包成函数是为了不在组件顶层直接读 props（Solid 的响应式规则）。
  const initialCategory = (): CategoryKey => (props.customOnly ? 'custom' : 'industry')
  const [category, setCategory] = createSignal<CategoryKey>(initialCategory())
  const [query, setQuery] = createSignal('')
  const [lists, setLists] = createSignal<Partial<Record<CategoryKey, PickerBoard[]>>>({})
  const [loading, setLoading] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  let requestId = 0

  /** 自定义板块来自自选分组，随时间变化，单独算 */
  const customBoards = createMemo<PickerBoard[]>(() =>
    appState.groups.map((group) => ({
      id: group.id,
      name: group.name,
      kind: 'custom',
      count: group.items.length,
      codes: group.items.map((item) => item.code),
      names: Object.fromEntries(group.items.map((item) => [item.code, item.name])),
      indexCode: ''
    }))
  )

  const load = async (key: CategoryKey): Promise<void> => {
    if (key === 'custom' || lists()[key]) return
    const current = ++requestId
    setLoading(true)
    setError(null)
    try {
      const blocks =
        key === 'industry'
          ? ((await api.block.industries()) as IndustryList).blocks
          : (await api.block.list(key)).blocks
      if (current !== requestId) return
      setLists((prev) => ({ ...prev, [key]: blocks }))
    } catch (cause) {
      if (current === requestId) setError(errorMessage(cause))
    } finally {
      if (current === requestId) setLoading(false)
    }
  }

  createEffect(() => void load(category()))

  onMount(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') props.onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const boards = createMemo<PickerBoard[]>(() => {
    if (category() === 'custom') return customBoards()
    return lists()[category()] ?? []
  })

  const filtered = createMemo(() => {
    const keyword = query().trim().toLowerCase()
    const all = boards()
    if (!keyword) return all
    return all.filter((board) => board.name.toLowerCase().includes(keyword))
  })

  const pick = (board: PickerBoard): void => {
    props.onPick({
      key: `${category()}:${board.id}`,
      kind: category(),
      name: board.name,
      codes: [...board.codes],
      names: { ...board.names },
      indexCode: board.indexCode || undefined,
      groupId: category() === 'custom' ? board.id : undefined
    })
    props.onClose()
  }

  return (
    <div class="sector-picker" role="dialog" aria-label="选择板块" onClick={() => props.onClose()}>
      <div
        class="sector-picker__panel"
        onClick={(event) => event.stopPropagation()}
        role="document"
      >
        <header class="sector-picker__head">
          <div>
            <div class="sector-picker__eyebrow">板块 · 成分股排行</div>
            <h2 class="sector-picker__title">选择板块</h2>
          </div>
          <button class="btn btn--icon" aria-label="关闭板块选择" onClick={() => props.onClose()}>
            <IconClose size={14} />
          </button>
        </header>

        <div class="sector-picker__tools">
          <div class="sector-picker__tabs" role="tablist">
            <For each={CATEGORIES.filter((item) => !props.customOnly || item.key === 'custom')}>
              {(item) => (
                <button
                  class={`sector-picker__tab sector-picker__tab--${item.key}`}
                  role="tab"
                  data-active={category() === item.key}
                  onClick={() => {
                    setCategory(item.key)
                    setQuery('')
                  }}
                >
                  {item.label}
                </button>
              )}
            </For>
          </div>
          <input
            class="sector-picker__search"
            placeholder="搜索板块名称"
            value={query()}
            onInput={(event) => setQuery(event.currentTarget.value)}
            autofocus
          />
        </div>

        <Show when={error()}>
          {(message) => <div class="sector-picker__error">{message()}</div>}
        </Show>

        <div class="sector-picker__body">
          <Show
            when={!loading() || filtered().length > 0}
            fallback={<div class="sector-picker__hint">加载板块列表…</div>}
          >
            <Show
              when={filtered().length > 0}
              fallback={
                <div class="sector-picker__hint">
                  {query()
                    ? '没有匹配的板块'
                    : category() === 'custom'
                      ? '还没有自定义板块：先在左栏「+」新建分组'
                      : '没有板块数据'}
                </div>
              }
            >
              <div class="sector-picker__grid">
                <For each={filtered()}>
                  {(board) => (
                    <button
                      class="sector-card"
                      data-kind={category()}
                      title={`${board.name} · ${board.codes.length} 只成分股`}
                      onClick={() => pick(board)}
                    >
                      <span class="sector-card__name">{board.name}</span>
                      <span class="sector-card__count num">{board.codes.length}</span>
                    </button>
                  )}
                </For>
              </div>
            </Show>
          </Show>
        </div>

        <footer class="sector-picker__foot">
          共 {filtered().length} 个板块 · 选中后左栏按涨跌幅显示成分股排行
        </footer>
      </div>
    </div>
  )
}
