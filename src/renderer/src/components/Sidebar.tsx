/**
 * 自选股列表（左栏）：分组标签 + 当前分组的股票列表。
 *
 * 这里有**两种**拖拽，落点判断必须区分开，否则会互相打架：
 *   ① 拖动「股票行」→ 目标是分组标签（跨组移动）或同组其它行（排序）；
 *   ② 拖动「分组标签」→ 目标是另一个分组标签（调整分组顺序）。
 *
 * 判断依据是 `draggingCode()`（来自 store，股票行设置）
 * 与 `draggingGroup()`（本组件内部，分组标签设置）。
 *
 * 其它交互：点标签切换分组；双击标签就地改名；悬停时出现删除按钮；
 * 列表空白处也能接收拖入（追加到末尾）；空分组显示引导文案。
 */
import { createEffect, createMemo, createSignal, For, Show, type JSX } from 'solid-js'
import type { Quote, WatchGroup } from '@shared/types'
import { fixed, signedPct } from '@shared/format'
import {
  appState,
  createGroup,
  defaultGroup,
  draggingCode,
  moveGroup,
  moveWatchItem,
  removeGroup,
  renameGroup,
  setActiveCode,
  setActiveGroup,
  setDraggingCode,
  watchItems
} from '../stores/app'
import { applyQuotes, quoteOf } from '../stores/quotes'
import { openStockMenu } from '../stores/stockMenu'
import { api, errorMessage } from '../lib/ipc'
import { toneOf } from '../lib/tone'
import { SectorPicker, type SectorSelection } from './SectorPicker'
import {
  IconChart,
  IconClose,
  IconColumns,
  IconFilter,
  IconGrid,
  IconInfo,
  IconList,
  IconMaximize,
  IconPlus,
  IconStar
} from './Icons'
import { WatchRow } from './WatchRow'

type DropSide = 'before' | 'after'

interface SidebarProps {
  onOpenRanking: () => void
  onOpenBlocks: () => void
  onOpenScreener: () => void
  onOpenMulti: () => void
  onOpenPortfolio: () => void
  onOpenMarket: () => void
  onOpenFullWatchlist: () => void
}

/**
 * 板块排行 / 自定义排行里的一行。
 *
 * 和自选股行不同，这里没有拖拽和删除：成分股是板块数据，不是用户维护的列表。
 */
function SectorRow(props: { code: string; name: string; onPick: () => void }): JSX.Element {
  const quote = (): Quote | undefined => quoteOf(props.code)
  const tone = (): string => toneOf(quote()?.changePct)
  return (
    <button
      class="sector-row"
      data-active={appState.activeCode === props.code}
      title={`${props.name} ${props.code.toUpperCase()}`}
      onClick={() => props.onPick()}
      onContextMenu={(event) => openStockMenu(event, { code: props.code, name: props.name })}
    >
      <span class="sector-row__name">{props.name}</span>
      <span class="sector-row__nums">
        <span class="sector-row__price num">{quote() ? fixed(quote()!.price) : '—'}</span>
        <span class={`sector-row__chg num ${tone()}`}>
          {quote() ? signedPct(quote()!.changePct) : '—'}
        </span>
      </span>
    </button>
  )
}

export function Sidebar(props: SidebarProps): JSX.Element {
  const [editingId, setEditingId] = createSignal<string | null>(null)
  const [draft, setDraft] = createSignal('')

  /** 股票拖到分组标签上时，高亮该标签 */
  const [stockDropGroupId, setStockDropGroupId] = createSignal<string | null>(null)
  /** 正在被拖动的分组（调整分组顺序） */
  const [draggingGroup, setDraggingGroup] = createSignal<string | null>(null)
  /** 分组排序时的落点：插到哪个标签的前面/后面 */
  const [groupDrop, setGroupDrop] = createSignal<{ id: string; side: DropSide } | null>(null)

  /* ------------------------------------------- 自选股 / 板块 / 自定义 三种视图 */
  type SidebarView = 'watch' | 'sector' | 'custom'
  const [view, setView] = createSignal<SidebarView>('watch')
  const [pickerOpen, setPickerOpen] = createSignal(false)
  const [pickerCustomOnly, setPickerCustomOnly] = createSignal(false)
  /** 板块视图当前选中的板块 */
  const [sector, setSector] = createSignal<SectorSelection | null>(null)
  /** 自定义视图当前选中的分组 */
  const [customSector, setCustomSector] = createSignal<SectorSelection | null>(null)
  const [sectorLoading, setSectorLoading] = createSignal(false)
  const [sectorError, setSectorError] = createSignal<string | null>(null)

  const totalCount = (): number =>
    appState.groups.reduce((sum, group) => sum + group.items.length, 0)

  /** 板块成分股不在自选订阅里，得按代码批量补一次 MAC 报价 */
  const loadSectorQuotes = async (selection: SectorSelection): Promise<void> => {
    setSectorLoading(true)
    setSectorError(null)
    try {
      const codes = selection.codes
      for (let start = 0; start < codes.length; start += 120) {
        const chunk = codes.slice(start, start + 120)
        if (chunk.length === 0) continue
        applyQuotes(await api.quote.macQuotes(chunk))
      }
    } catch (cause) {
      setSectorError(errorMessage(cause))
    } finally {
      setSectorLoading(false)
    }
  }

  createEffect(() => {
    const selection = sector()
    if (!selection || view() !== 'sector') return
    void loadSectorQuotes(selection)
  })

  const groupSelection = (group: WatchGroup): SectorSelection => ({
    key: `custom:${group.id}`,
    kind: 'custom',
    name: group.name,
    codes: group.items.map((item) => item.code),
    names: Object.fromEntries(group.items.map((item) => [item.code, item.name])),
    groupId: group.id
  })

  const openPicker = (customOnly: boolean): void => {
    setPickerCustomOnly(customOnly)
    setPickerOpen(true)
  }

  const openSectorView = (): void => {
    setView('sector')
    if (!sector()) openPicker(false)
  }

  const openCustomView = (): void => {
    setView('custom')
    if (!customSector()) {
      // 自选不是自定义板块：默认选第一个真正的自定义分组
      const group = appState.groups.find((item) => item.id !== defaultGroup()?.id)
      if (group) {
        setCustomSector(groupSelection(group))
        setActiveGroup(group.id)
        return
      }
      openPicker(true)
    }
  }

  const pickSector = (selection: SectorSelection): void => {
    if (selection.kind === 'custom') {
      setCustomSector(selection)
      // 自定义板块就是分组：选完顺手切过去，回「自选股」时也是这一组
      if (selection.groupId) setActiveGroup(selection.groupId)
      setView('custom')
      return
    }
    setSector(selection)
    setView('sector')
  }

  /** 按涨跌幅从高到低：排行列表的唯一排序规则 */
  const rankRows = (
    selection: SectorSelection | null
  ): Array<{ code: string; name: string; quote: Quote | undefined }> => {
    if (!selection) return []
    return selection.codes
      .map((code) => ({
        code,
        name: selection.names[code] || quoteOf(code)?.name || code,
        quote: quoteOf(code)
      }))
      .sort(
        (a, b) =>
          (b.quote?.changePct ?? Number.NEGATIVE_INFINITY) -
          (a.quote?.changePct ?? Number.NEGATIVE_INFINITY)
      )
  }

  const sectorRows = createMemo(() => rankRows(sector()))
  /**
   * 自定义板块按 groupId 现算，而不是用选择时的快照：
   * 用户在这个分组里加/删股票后，排行要立刻跟着变。
   */
  const customBoard = createMemo(() => {
    const selection = customSector()
    if (!selection?.groupId) return selection
    const group = appState.groups.find((item) => item.id === selection.groupId)
    return group ? groupSelection(group) : selection
  })
  const customRows = createMemo(() => rankRows(customBoard()))
  /** 「自定义板块」= 除自选之外的所有分组；自选那一组不再以分组形式出现 */
  const customGroups = createMemo(() =>
    appState.groups.filter((group) => group.id !== defaultGroup()?.id)
  )

  const startRename = (group: WatchGroup): void => {
    setDraft(group.name)
    setEditingId(group.id)
  }

  const commitRename = (): void => {
    const id = editingId()
    if (id) renameGroup(id, draft())
    setEditingId(null)
  }

  /** 拖到分组标签上 → 移动到该分组末尾 */
  const dropStockOnGroup = (event: DragEvent, groupId: string): void => {
    event.preventDefault()
    const code = draggingCode() ?? event.dataTransfer?.getData('text/plain')
    setStockDropGroupId(null)
    setDraggingCode(null)
    if (!code) return

    const target = appState.groups.find((group) => group.id === groupId)
    moveWatchItem(code, groupId, target?.items.length ?? 0)
  }

  /** 拖到列表空白处 → 追加到自选股末尾（自选只有一层） */
  const dropStockOnList = (event: DragEvent): void => {
    event.preventDefault()
    const code = draggingCode() ?? event.dataTransfer?.getData('text/plain')
    setDraggingCode(null)
    if (!code) return
    const groupId = defaultGroup()?.id
    if (!groupId) return
    moveWatchItem(code, groupId, watchItems().length)
  }

  /** 分组排序：按鼠标在标签内的水平位置决定插到前面还是后面 */
  const onGroupDragOver = (event: DragEvent, groupId: string): void => {
    if (draggingCode()) {
      event.preventDefault()
      setStockDropGroupId(groupId)
      return
    }
    const source = draggingGroup()
    if (!source || source === groupId) return

    event.preventDefault()
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
    const side: DropSide = event.clientX < rect.left + rect.width / 2 ? 'before' : 'after'
    setGroupDrop({ id: groupId, side })
  }

  const onGroupDrop = (event: DragEvent, groupId: string): void => {
    // 股票 → 分组：走跨组移动
    if (draggingCode()) {
      dropStockOnGroup(event, groupId)
      return
    }

    // 分组 → 分组：调整顺序
    event.preventDefault()
    const source = draggingGroup()
    const target = groupDrop()
    setGroupDrop(null)
    setDraggingGroup(null)
    if (!source || source === groupId) return

    const index = appState.groups.findIndex((group) => group.id === groupId)
    if (index < 0) return
    moveGroup(source, target?.side === 'after' ? index + 1 : index)
  }

  return (
    <aside class="sidebar">
      <div class="sidebar__head">
        <div class="sidebar__title">
          <IconStar size={12} />
          {view() === 'watch' ? '自选股' : view() === 'sector' ? '板块排行' : '自定义板块'}
          <span class="badge">
            {view() === 'watch'
              ? totalCount()
              : view() === 'sector'
                ? (sector()?.codes.length ?? 0)
                : (customBoard()?.codes.length ?? 0)}
          </span>
        </div>
        <button
          class="btn btn--icon btn--bare watch-fullscreen-open"
          title="全屏自选（每页 24 只）"
          aria-label="打开全屏自选"
          onClick={() => props.onOpenFullWatchlist()}
        >
          <IconMaximize size={13} />
        </button>
        <button
          class="btn btn--icon btn--bare multi-open"
          title="多股同列"
          aria-label="打开多股同列"
          onClick={() => props.onOpenMulti()}
        >
          <IconColumns size={13} />
        </button>
        <button
          class="btn btn--icon btn--bare screener-open"
          title="条件选股"
          aria-label="打开条件选股"
          onClick={() => props.onOpenScreener()}
        >
          <IconFilter size={13} />
        </button>
        <button
          class="btn btn--icon btn--bare market-open"
          title="全市场列表"
          aria-label="打开全市场列表"
          onClick={() => props.onOpenMarket()}
        >
          <IconList size={13} />
        </button>
        <button
          class="btn btn--icon btn--bare block-open"
          title="板块 / 概念"
          aria-label="打开板块与概念"
          onClick={() => props.onOpenBlocks()}
        >
          <IconGrid size={13} />
        </button>
        <button
          class="btn btn--icon btn--bare portfolio-open"
          title="组合分析"
          aria-label="打开组合分析"
          onClick={() => props.onOpenPortfolio()}
        >
          <IconInfo size={13} />
        </button>
        <button
          class="btn btn--icon btn--bare ranking-open"
          title="排行榜"
          aria-label="打开 A 股排行榜"
          onClick={() => props.onOpenRanking()}
        >
          <IconChart size={13} />
        </button>
        <button
          class="btn btn--icon btn--bare"
          title="新建自定义板块"
          onClick={() => {
            createGroup()
            // 新建后直接切到自定义板块视图并选中它
            const created = appState.groups[appState.groups.length - 1]
            if (!created) return
            setView('custom')
            setCustomSector(groupSelection(created))
          }}
        >
          <IconPlus size={13} />
        </button>
      </div>

      <div class="sidebar__modes" role="tablist" aria-label="左侧列表类型">
        <button
          class="sidebar__mode"
          role="tab"
          data-active={view() === 'watch'}
          onClick={() => {
            setView('watch')
            // 切回自选时把「当前分组」也复位，其它面板（多股同列/组合/全屏）才不会停在上一个自定义板块
            const group = defaultGroup()
            if (group) setActiveGroup(group.id)
          }}
        >
          自选股
        </button>
        <button
          class="sidebar__mode"
          role="tab"
          data-active={view() === 'sector'}
          onClick={openSectorView}
        >
          板块
        </button>
        <button
          class="sidebar__mode"
          role="tab"
          data-active={view() === 'custom'}
          onClick={openCustomView}
        >
          自定义
        </button>
      </div>

      <Show when={view() === 'watch'}>
        <div
          class="sidebar__list"
          onDragOver={(event) => draggingCode() && event.preventDefault()}
          onDrop={dropStockOnList}
        >
          <Show
            when={watchItems().length > 0}
            fallback={
              <div class="group-empty">
                自选股还是空的
                <br />
                搜索添加，或右键其它列表「加入自选股」
              </div>
            }
          >
            <For each={watchItems()}>
              {(item, index) => (
                <WatchRow
                  item={item}
                  index={index()}
                  groupId={defaultGroup()?.id ?? appState.activeGroupId}
                />
              )}
            </For>
          </Show>
        </div>
      </Show>

      <Show when={view() === 'sector'}>
        <div class="sector-head">
          <button class="sector-head__pick" title="选择板块" onClick={() => openPicker(false)}>
            <span class="sector-head__name">{sector()?.name ?? '选择板块'}</span>
            <span class="sector-head__count num">{sector()?.codes.length ?? 0}</span>
          </button>
          <button
            class="btn btn--icon btn--bare"
            title="换一个板块"
            aria-label="换一个板块"
            onClick={() => openPicker(false)}
          >
            <IconGrid size={13} />
          </button>
        </div>
        <Show when={sectorError()}>{(message) => <div class="sector-error">{message()}</div>}</Show>
        <div class="sidebar__list sector-list">
          <Show
            when={sector()}
            fallback={
              <div class="group-empty">
                点上方「选择板块」
                <br />
                按涨跌幅查看该板块个股排行
              </div>
            }
          >
            <Show when={sectorLoading()}>
              <div class="sector-loading">加载成分股行情…</div>
            </Show>
            <For each={sectorRows()}>
              {(row) => (
                <SectorRow code={row.code} name={row.name} onPick={() => setActiveCode(row.code)} />
              )}
            </For>
          </Show>
        </div>
      </Show>

      <Show when={view() === 'custom'}>
        <div class="sector-head">
          <button class="sector-head__pick" title="选择自定义板块" onClick={() => openPicker(true)}>
            <span class="sector-head__name">{customBoard()?.name ?? '选择自定义板块'}</span>
            <span class="sector-head__count num">{customBoard()?.codes.length ?? 0}</span>
          </button>
          <button
            class="btn btn--icon btn--bare"
            title="换一个自定义板块"
            aria-label="换一个自定义板块"
            onClick={() => openPicker(true)}
          >
            <IconGrid size={13} />
          </button>
        </div>
        <div class="group-tabs group-tabs--custom">
          <For each={customGroups()}>
            {(group) => (
              <div
                class="group-chip"
                classList={{
                  'group-chip--drop': stockDropGroupId() === group.id,
                  'group-chip--dragging': draggingGroup() === group.id,
                  'group-chip--drop-before':
                    groupDrop()?.id === group.id && groupDrop()?.side === 'before',
                  'group-chip--drop-after':
                    groupDrop()?.id === group.id && groupDrop()?.side === 'after'
                }}
                data-active={customSector()?.groupId === group.id}
                draggable={editingId() !== group.id}
                onClick={() => {
                  setCustomSector(groupSelection(group))
                  setActiveGroup(group.id)
                }}
                onDblClick={() => startRename(group)}
                onDragStart={(event) => {
                  if (editingId() === group.id) {
                    event.preventDefault()
                    return
                  }
                  setDraggingGroup(group.id)
                  event.dataTransfer?.setData('text/plain', group.id)
                  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
                }}
                onDragEnd={() => {
                  setDraggingGroup(null)
                  setGroupDrop(null)
                  setStockDropGroupId(null)
                }}
                onDragOver={(event) => onGroupDragOver(event, group.id)}
                onDragLeave={() => {
                  setStockDropGroupId((current) => (current === group.id ? null : current))
                  setGroupDrop((current) => (current?.id === group.id ? null : current))
                }}
                onDrop={(event) => onGroupDrop(event, group.id)}
                title={`${group.name} · ${group.items.length} 只（双击改名，拖拽可调整顺序或接收股票）`}
              >
                <Show
                  when={editingId() === group.id}
                  fallback={
                    <>
                      <span class="group-chip__name">{group.name}</span>
                      <span class="group-chip__count num">{group.items.length}</span>
                      <span
                        class="group-chip__close"
                        role="button"
                        aria-label="删除自定义板块"
                        onClick={(event) => {
                          event.stopPropagation()
                          removeGroup(group.id)
                        }}
                      >
                        <IconClose size={9} />
                      </span>
                    </>
                  }
                >
                  <input
                    class="group-chip__input"
                    value={draft()}
                    autofocus
                    onInput={(event) => setDraft(event.currentTarget.value)}
                    onBlur={commitRename}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') commitRename()
                      if (event.key === 'Escape') setEditingId(null)
                    }}
                    onClick={(event) => event.stopPropagation()}
                  />
                </Show>
              </div>
            )}
          </For>
          <Show when={customGroups().length === 0}>
            <span class="group-tabs__hint">还没有自定义板块，点右上「+」新建</span>
          </Show>
        </div>
        <div class="sidebar__list sector-list">
          <Show
            when={customSector()}
            fallback={
              <div class="group-empty">
                点上方选择一个自定义板块
                <br />
                （自定义板块就是自选分组，可用「+」新建）
              </div>
            }
          >
            <For each={customRows()}>
              {(row) => (
                <SectorRow code={row.code} name={row.name} onPick={() => setActiveCode(row.code)} />
              )}
            </For>
          </Show>
        </div>
      </Show>

      <Show when={pickerOpen()}>
        <SectorPicker
          customOnly={pickerCustomOnly()}
          onClose={() => setPickerOpen(false)}
          onPick={pickSector}
        />
      </Show>

      <div class="sidebar__foot">
        数据来源 通达信行情
        <br />
        行情有延迟，仅供参考，不构成投资建议
      </div>
    </aside>
  )
}
