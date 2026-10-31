/**
 * 自绘标题栏。
 *
 * 窗口是无边框的（frame: false），所以这一条既是「品牌区」也是「拖拽区」，
 * 还要自己实现最小化/最大化/关闭三个按钮。
 * 注意 CSS 里的 -webkit-app-region：drag 让空白处能拖窗口，
 * 而按钮必须设成 no-drag，否则会点不动。
 */
import { createSignal, onCleanup, onMount, Show, type JSX } from 'solid-js'
import type { WindowAction } from '@shared/types'
import { api } from '../lib/ipc'
import { appInfo, toggleTheme, appState } from '../stores/app'
import {
  IconBell,
  IconClose,
  IconColumns,
  IconMaximize,
  IconMinimize,
  IconMoon,
  IconRestore,
  IconSettings,
  IconSun
} from './Icons'
import { SearchBox } from './SearchBox'

interface TitleBarProps {
  onOpenData: () => void
  onOpenUnusual: () => void
  onOpenDragon: () => void
  onOpenBoards: () => void
  onOpenAlerts: () => void
  onOpenSettings: () => void
  onOpenSecondary: () => void
  sidebarHidden: boolean
  onToggleSidebar: () => void
}

export function TitleBar(props: TitleBarProps): JSX.Element {
  return (
    <header class="titlebar">
      <div class="titlebar__brand">
        <div class="titlebar__logo" />
        <span class="titlebar__title">StockLens</span>
      </div>

      {/* 左右两个弹性空白，让搜索框大致居中 */}
      <div class="titlebar__drag" />
      <SearchBox />
      <div class="titlebar__drag" />

      <div class="titlebar__actions">
        <button
          class="btn btn--icon btn--bare sidebar-toggle"
          title={props.sidebarHidden ? '显示左侧自选栏' : '隐藏左侧自选栏'}
          aria-label={props.sidebarHidden ? '显示左侧自选栏' : '隐藏左侧自选栏'}
          aria-pressed={props.sidebarHidden}
          onClick={() => props.onToggleSidebar()}
        >
          <IconColumns size={15} />
        </button>
        <button
          class="btn btn--icon btn--bare alerts-open"
          title="行情预警"
          aria-label="打开行情预警"
          onClick={() => props.onOpenAlerts()}
        >
          <IconBell size={15} />
        </button>
        <button
          class="btn btn--bare unusual-open"
          title="沪深异动"
          onClick={() => props.onOpenUnusual()}
        >
          异动
        </button>
        <button
          class="btn btn--bare dragon-open"
          title="沪深龙虎榜"
          onClick={() => props.onOpenDragon()}
        >
          龙虎
        </button>
        <button
          class="btn btn--bare boards-open"
          title="板块行情"
          onClick={() => props.onOpenBoards()}
        >
          板块
        </button>
        <button class="btn btn--bare data-open" title="数据工具" onClick={() => props.onOpenData()}>
          数据
        </button>
        <button
          class="btn btn--bare window-secondary"
          title="打开第二个主窗口"
          onClick={() => props.onOpenSecondary()}
        >
          新窗
        </button>
        <button
          class="btn btn--icon btn--bare settings-open"
          title="设置"
          onClick={() => props.onOpenSettings()}
        >
          <IconSettings size={15} />
        </button>
        <button
          class="btn btn--icon btn--bare"
          title={appState.settings.theme === 'dark' ? '切换到浅色主题' : '切换到深色主题'}
          onClick={toggleTheme}
        >
          <Show when={appState.settings.theme === 'dark'} fallback={<IconSun size={15} />}>
            <IconMoon size={15} />
          </Show>
        </button>
        <WindowControls />
      </div>
    </header>
  )
}

function WindowControls(): JSX.Element {
  const [maximized, setMaximized] = createSignal(false)

  onMount(() => {
    const dispose = api.window.onStateChange((state) => setMaximized(state.maximized))
    onCleanup(dispose)
  })

  const control = (action: WindowAction): void => {
    void api.window.control(action).then((state) => setMaximized(state.maximized))
  }

  return (
    <Show when={appInfo()?.platform !== 'darwin' && appInfo()?.platform !== 'web'}>
      <div class="win-controls">
        <button class="win-btn" title="最小化" onClick={() => control('minimize')}>
          <IconMinimize size={16} />
        </button>
        <button
          class="win-btn"
          title={maximized() ? '向下还原' : '最大化'}
          onClick={() => control('toggle-maximize')}
        >
          <Show when={maximized()} fallback={<IconMaximize size={15} />}>
            <IconRestore size={15} />
          </Show>
        </button>
        <button class="win-btn win-btn--close" title="关闭" onClick={() => control('close')}>
          <IconClose size={16} />
        </button>
      </div>
    </Show>
  )
}
