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
import { createSignal, For, Show, type JSX } from 'solid-js'
import type { WatchGroup } from '@shared/types'
import {
  activeItems,
  appState,
  createGroup,
  draggingCode,
  moveGroup,
  moveWatchItem,
  removeGroup,
  renameGroup,
  setActiveGroup,
  setDraggingCode
} from '../stores/app'
import { IconChart, IconClose, IconFilter, IconGrid, IconPlus, IconStar } from './Icons'
import { WatchRow } from './WatchRow'

type DropSide = 'before' | 'after'

interface SidebarProps {
  onOpenRanking: () => void
  onOpenBlocks: () => void
  onOpenScreener: () => void
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

  const totalCount = (): number =>
    appState.groups.reduce((sum, group) => sum + group.items.length, 0)

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

  /** 拖到列表空白处 → 追加到当前分组末尾 */
  const dropStockOnList = (event: DragEvent): void => {
    event.preventDefault()
    const code = draggingCode() ?? event.dataTransfer?.getData('text/plain')
    setDraggingCode(null)
    if (!code) return
    moveWatchItem(code, appState.activeGroupId, activeItems().length)
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
          自选股
          <span class="badge">{totalCount()}</span>
        </div>
        <button
          class="btn btn--icon btn--bare screener-open"
          title="条件选股"
          aria-label="打开条件选股"
          onClick={() => props.onOpenScreener()}
        >
          <IconFilter size={13} />
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
          class="btn btn--icon btn--bare ranking-open"
          title="排行榜"
          aria-label="打开 A 股排行榜"
          onClick={() => props.onOpenRanking()}
        >
          <IconChart size={13} />
        </button>
        <button
          class="btn btn--icon btn--bare"
          title="新建分组"
          onClick={() => {
            createGroup()
            // 新建后直接进入改名状态，省一次点击
            const created = appState.groups[appState.groups.length - 1]
            if (created) startRename(created)
          }}
        >
          <IconPlus size={13} />
        </button>
      </div>

      <div class="group-tabs">
        <For each={appState.groups}>
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
              data-active={group.id === appState.activeGroupId}
              draggable={editingId() !== group.id}
              onClick={() => setActiveGroup(group.id)}
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
                    <Show when={appState.groups.length > 1}>
                      <span
                        class="group-chip__close"
                        role="button"
                        aria-label="删除分组"
                        onClick={(event) => {
                          event.stopPropagation()
                          removeGroup(group.id)
                        }}
                      >
                        <IconClose size={9} />
                      </span>
                    </Show>
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
      </div>

      <div
        class="sidebar__list"
        onDragOver={(event) => draggingCode() && event.preventDefault()}
        onDrop={dropStockOnList}
      >
        <Show
          when={activeItems().length > 0}
          fallback={
            <div class="group-empty">
              这个分组还是空的
              <br />
              搜索添加，或把其它分组的股票拖进来
            </div>
          }
        >
          <For each={activeItems()}>
            {(item, index) => (
              <WatchRow item={item} index={index()} groupId={appState.activeGroupId} />
            )}
          </For>
        </Show>
      </div>

      <div class="sidebar__foot">
        数据来源 通达信行情
        <br />
        行情有延迟，仅供参考，不构成投资建议
      </div>
    </aside>
  )
}
