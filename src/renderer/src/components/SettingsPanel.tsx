/**
 * 设置面板：把散落在顶栏/状态栏/图表的开关集中到一处。
 */
import { createSignal, For, Show, type JSX } from 'solid-js'
import type { AppSettings, LayoutSlot, ThemeMode } from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/types'
import { appInfo, appState, toggleTheme, updateSettings } from '../stores/app'
import { downloadText } from '../lib/download'
import { IconClose } from './Icons'

const INTERVALS = [1000, 3000, 5000, 10_000] as const

const LAYOUTS = [
  { id: 'default', label: '默认', sidebar: 264, rail: 318 },
  { id: 'chart', label: '宽图表', sidebar: 224, rail: 280 },
  { id: 'rail', label: '宽盘口', sidebar: 280, rail: 380 }
] as const

export function SettingsPanel(props: { onClose: () => void }): JSX.Element {
  const [permission, setPermission] = createSignal(
    typeof Notification === 'undefined' ? 'unsupported' : Notification.permission
  )

  const requestNotify = async (): Promise<void> => {
    if (typeof Notification === 'undefined') return
    setPermission(await Notification.requestPermission())
  }

  const reset = (): void => {
    updateSettings({ ...DEFAULT_SETTINGS, chartDrawings: [] })
  }

  let importInput: HTMLInputElement | undefined

  const exportSettings = (): void => {
    downloadText('stocklens-settings.json', JSON.stringify(appState.settings, null, 2))
  }

  const importSettings = async (file: File): Promise<void> => {
    try {
      const parsed = JSON.parse(await file.text()) as Partial<AppSettings>
      if (!parsed || typeof parsed !== 'object') return
      updateSettings(parsed)
    } catch {
      // 非 JSON 文件直接忽略，避免把设置写坏。
    }
  }

  const saveLayout = (): void => {
    const slot: LayoutSlot = {
      sidebar: appState.settings.sidebarWidth ?? 264,
      rail: appState.settings.railWidth ?? 318,
      savedAt: Date.now()
    }
    updateSettings({
      layoutSlots: [slot, ...(appState.settings.layoutSlots ?? [])].slice(0, 3)
    })
  }

  const applyLayout = (slot: LayoutSlot): void => {
    updateSettings({ sidebarWidth: slot.sidebar, railWidth: slot.rail })
  }

  const removeLayout = (index: number): void => {
    updateSettings({
      layoutSlots: (appState.settings.layoutSlots ?? []).filter((_, item) => item !== index)
    })
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
              <div class="settings__label">自定义版面</div>
              <div class="settings__hint">保存当前左右栏宽度，最多 3 套；点击应用。</div>
            </div>
            <div class="settings__slots">
              <button class="btn settings__slot-save" onClick={saveLayout}>
                保存当前
              </button>
              <For each={appState.settings.layoutSlots ?? []}>
                {(slot, index) => (
                  <span class="settings__slot">
                    <button
                      class={`settings__slot-apply settings__slot-apply-${index() + 1}`}
                      onClick={() => applyLayout(slot)}
                    >
                      版面 {index() + 1} · {slot.sidebar}/{slot.rail}
                    </button>
                    <button
                      class="settings__slot-remove"
                      title="删除版面"
                      onClick={() => removeLayout(index())}
                    >
                      ×
                    </button>
                  </span>
                )}
              </For>
            </div>
          </div>

          <Show when={appInfo()?.platform === 'web'}>
            <div class="settings__row">
              <div>
                <div class="settings__label">浏览器通知</div>
                <div class="settings__hint">预警触发时发送系统通知；需浏览器授权。</div>
              </div>
              <div class="settings__notify">
                <span class="settings__notify-state">
                  {permission() === 'granted'
                    ? '已授权'
                    : permission() === 'denied'
                      ? '已拒绝'
                      : permission() === 'unsupported'
                        ? '不支持'
                        : '未授权'}
                </span>
                <button
                  class="btn settings__notify-request"
                  disabled={permission() === 'granted' || permission() === 'unsupported'}
                  onClick={() => void requestNotify()}
                >
                  授权通知
                </button>
              </div>
            </div>
          </Show>

          <div class="settings__row">
            <div>
              <div class="settings__label">配置备份</div>
              <div class="settings__hint">只导出设置，不含自选、预警与持仓。</div>
            </div>
            <div class="settings__backup">
              <button class="btn settings__export" onClick={exportSettings}>
                导出
              </button>
              <button class="btn settings__import" onClick={() => importInput?.click()}>
                导入
              </button>
              <input
                ref={(element: HTMLInputElement) => {
                  importInput = element
                }}
                class="settings__import-input"
                type="file"
                accept="application/json,.json"
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0]
                  if (file) void importSettings(file)
                  event.currentTarget.value = ''
                }}
              />
            </div>
          </div>

          <div class="settings__row">
            <div>
              <div class="settings__label">主图均线</div>
              <div class="settings__hint">三条均线周期，K 线重启后继续生效。</div>
            </div>
            <div class="settings__ma">
              <For each={[0, 1, 2]}>
                {(index) => (
                  <input
                    class={`settings__ma-${index}`}
                    type="number"
                    min="1"
                    max="120"
                    value={String((appState.settings.maPeriods ?? [5, 10, 20])[index])}
                    onChange={(event) => {
                      const next = [...(appState.settings.maPeriods ?? [5, 10, 20])] as [
                        number,
                        number,
                        number
                      ]
                      const parsed = Number(event.currentTarget.value)
                      next[index] =
                        Number.isFinite(parsed) && parsed > 0
                          ? Math.min(120, Math.floor(parsed))
                          : next[index]
                      updateSettings({ maPeriods: next })
                    }}
                  />
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
