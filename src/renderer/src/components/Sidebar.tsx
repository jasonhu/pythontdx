/**
 * 自选股列表（左栏）：分组标签 + 当前分组的股票列表。
 *
 * 交互：
 *   · 点标签切换分组；双击标签就地改名；悬停时标签右侧出现删除按钮；
 *   · 股票行可拖拽排序，也可以拖到别的分组标签上完成跨组移动；
 *   · 列表空白处也能接收拖入（追加到末尾），空分组会显示引导文案。
 */
import { createSignal, For, Show, type JSX } from 'solid-js'
import type { WatchGroup } from '@shared/types'
import {
  activeItems,
  appState,
  createGroup,
  draggingCode,
  moveWatchItem,
  removeGroup,
  renameGroup,
  setActiveGroup,
  setDraggingCode
} from '../stores/app'
import { IconClose, IconPlus, IconStar } from './Icons'
import { WatchRow } from './WatchRow'

export function Sidebar(): JSX.Element {
  const [editingId, setEditingId] = createSignal<string | null>(null)
  const [draft, setDraft] = createSignal('')
  const [dropGroupId, setDropGroupId] = createSignal<string | null>(null)

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
  const dropOnGroup = (event: DragEvent, groupId: string): void => {
    event.preventDefault()
    const code = draggingCode() ?? event.dataTransfer?.getData('text/plain')
    setDropGroupId(null)
    setDraggingCode(null)
    if (!code) return

    const target = appState.groups.find((group) => group.id === groupId)
    moveWatchItem(code, groupId, target?.items.length ?? 0)
  }

  /** 拖到列表空白处 → 追加到当前分组末尾 */
  const dropOnList = (event: DragEvent): void => {
    event.preventDefault()
    const code = draggingCode() ?? event.dataTransfer?.getData('text/plain')
    setDraggingCode(null)
    if (!code) return
    moveWatchItem(code, appState.activeGroupId, activeItems().length)
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
              classList={{ 'group-chip--drop': dropGroupId() === group.id }}
              data-active={group.id === appState.activeGroupId}
              onClick={() => setActiveGroup(group.id)}
              onDblClick={() => startRename(group)}
              onDragOver={(event) => {
                if (!draggingCode()) return
                event.preventDefault()
                setDropGroupId(group.id)
              }}
              onDragLeave={() =>
                setDropGroupId((current) => (current === group.id ? null : current))
              }
              onDrop={(event) => dropOnGroup(event, group.id)}
              title={`${group.name} · ${group.items.length} 只（双击改名，可拖入）`}
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
        onDrop={dropOnList}
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
        数据来源 腾讯行情
        <br />
        行情有延迟，仅供参考，不构成投资建议
      </div>
    </aside>
  )
}
