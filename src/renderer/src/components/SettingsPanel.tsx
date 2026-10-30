/**
 * 设置面板：把散落在顶栏/状态栏/图表的开关集中到一处。
 */
import { For, type JSX } from 'solid-js'
import type { ThemeMode } from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/types'
import { appState, toggleTheme, updateSettings } from '../stores/app'
import { IconClose } from './Icons'

const INTERVALS = [1000, 3000, 5000, 10_000] as const

const LAYOUTS = [
  { id: 'default', label: '默认', sidebar: 264, rail: 318 },
  { id: 'chart', label: '宽图表', sidebar: 224, rail: 280 },
  { id: 'rail', label: '宽盘口', sidebar: 280, rail: 380 }
] as const

export function SettingsPanel(props: { onClose: () => void }): JSX.Element {
  const reset = (): void => {
    updateSettings({ ...DEFAULT_SETTINGS, chartDrawings: [] })
  }

  return (
    <div class="settings-backdrop" onClick={() => props.onClose()}>
      <section
        class="settings-panel"
        role="dialog"
        aria-modal="true"
        aria-label="设置"
        onClick={(event) => event.stopPropagation()}
      >
        <header class="settings__head">
          <div>
            <div class="settings__eyebrow">StockLens 设置</div>
            <h2 class="settings__title">行情与界面</h2>
          </div>
          <button class="btn btn--icon btn--bare" title="关闭设置" onClick={() => props.onClose()}>
            <IconClose size={16} />
          </button>
        </header>

        <div class="settings__body">
          <div class="settings__row">
            <div>
              <div class="settings__label">主题</div>
              <div class="settings__hint">深色为默认；切换立即生效。</div>
            </div>
            <div class="settings__choices">
              <For each={['dark', 'light'] as ThemeMode[]}>
                {(mode) => (
                  <button
                    class="settings__choice"
                    data-active={appState.settings.theme === mode}
                    onClick={() => {
                      if (appState.settings.theme !== mode) toggleTheme()
                    }}
                  >
                    {mode === 'dark' ? '深色' : '浅色'}
                  </button>
                )}
              </For>
            </div>
          </div>

          <div class="settings__row">
            <div>
              <div class="settings__label">行情刷新</div>
              <div class="settings__hint">轮询间隔越短越实时，也越耗网络。</div>
            </div>
            <div class="settings__choices">
              <For each={INTERVALS}>
                {(interval) => (
                  <button
                    class="settings__choice"
                    data-active={appState.settings.refreshInterval === interval}
                    onClick={() => updateSettings({ refreshInterval: interval })}
                  >
                    {interval / 1000}s
                  </button>
                )}
              </For>
            </div>
          </div>

          <label class="settings__row">
            <div>
              <div class="settings__label">窗口失焦暂停刷新</div>
              <div class="settings__hint">切到别的应用时停止轮询。</div>
            </div>
            <input
              type="checkbox"
              checked={appState.settings.pauseWhenHidden}
              onChange={(event) => updateSettings({ pauseWhenHidden: event.currentTarget.checked })}
            />
          </label>

          <label class="settings__row">
            <div>
              <div class="settings__label">关闭窗口时隐藏到托盘</div>
              <div class="settings__hint">点托盘菜单「退出」才会真正结束进程。</div>
            </div>
            <input
              type="checkbox"
              checked={appState.settings.closeToTray !== false}
              onChange={(event) => updateSettings({ closeToTray: event.currentTarget.checked })}
            />
          </label>

          <label class="settings__row">
            <div>
              <div class="settings__label">自选股迷你走势</div>
              <div class="settings__hint">侧栏每行显示当日分时缩略图。</div>
            </div>
            <input
              type="checkbox"
              checked={appState.settings.showSparkline}
              onChange={(event) => updateSettings({ showSparkline: event.currentTarget.checked })}
            />
          </label>

          <div class="settings__row">
            <div>
              <div class="settings__label">版面</div>
              <div class="settings__hint">也可以直接拖拽左右栏边界；双击手柄复位。</div>
            </div>
            <div class="settings__choices">
              <For each={LAYOUTS}>
                {(layout) => (
                  <button
                    class={`settings__choice settings__layout-${layout.id}`}
                    data-active={
                      (appState.settings.sidebarWidth ?? 264) === layout.sidebar &&
                      (appState.settings.railWidth ?? 318) === layout.rail
                    }
                    onClick={() =>
                      updateSettings({ sidebarWidth: layout.sidebar, railWidth: layout.rail })
                    }
                  >
                    {layout.label}
                  </button>
                )}
              </For>
            </div>
          </div>

          <div class="settings__row">
            <div>
              <div class="settings__label">图表默认</div>
              <div class="settings__hint">周期、复权、对数、副图在图表头单独记忆。</div>
            </div>
            <button class="btn settings__reset" onClick={reset}>
              恢复默认
            </button>
          </div>
        </div>

        <footer class="settings__foot">
          <span>设置立即写入本地配置</span>
          <span>不包含交易与授权数据</span>
        </footer>
      </section>
    </div>
  )
}
