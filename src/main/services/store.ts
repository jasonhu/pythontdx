/**
 * 本地持久化。
 *
 * 为什么不用 electron-store？
 *  - electron-store v9+ 是纯 ESM 包，与主进程的 CJS 产物搭配需要额外处理；
 *  - 需求本身很简单（读写一个 JSON），手写一遍反而更有助于理解 Electron 的 userData 目录。
 *
 * 写入策略：150ms 防抖 + 临时文件原子替换，避免频繁 IO 和「写一半崩了」导致文件损坏。
 */
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { DEFAULT_SETTINGS, SEED_WATCHLIST, type AppState } from '@shared/types'

/** 与界面无关、单独存放的窗口几何信息 */
export interface WindowBounds {
  x?: number
  y?: number
  width: number
  height: number
}

interface PersistedFile {
  version: number
  state: AppState
  window?: WindowBounds
}

const CURRENT_VERSION = 1
const SAVE_DEBOUNCE_MS = 150

function createDefaultState(): AppState {
  return {
    version: CURRENT_VERSION,
    watchlist: SEED_WATCHLIST.map((item) => ({ ...item })),
    settings: { ...DEFAULT_SETTINGS },
    activeCode: SEED_WATCHLIST[0]?.code ?? null
  }
}

export class AppStore {
  private data: PersistedFile = { version: CURRENT_VERSION, state: createDefaultState() }
  private saveTimer: NodeJS.Timeout | null = null
  private dirty = false

  constructor(private readonly filePath: string) {}

  /** 同步读取：启动阶段调用一次，简单直接 */
  load(): void {
    if (!existsSync(this.filePath)) return
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf-8')) as Partial<PersistedFile>
      this.data = {
        version: CURRENT_VERSION,
        state: this.mergeState(parsed.state),
        window: parsed.window
      }
    } catch (error) {
      // 文件损坏时不要炸掉整个 App，退回默认值并留个日志
      console.error('[store] 配置文件解析失败，已回退到默认配置：', error)
    }
  }

  get state(): AppState {
    return this.data.state
  }

  get bounds(): WindowBounds | undefined {
    return this.data.window
  }

  /** 增量更新状态（浅合并 settings，watchlist 整体替换） */
  patchState(patch: Partial<AppState>): AppState {
    this.data.state = this.mergeState({ ...this.data.state, ...patch })
    this.scheduleSave()
    return this.data.state
  }

  saveBounds(bounds: WindowBounds): void {
    this.data.window = bounds
    this.scheduleSave()
  }

  /** 立即落盘（退出前调用） */
  async flush(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    if (!this.dirty) return
    await this.write()
  }

  private mergeState(partial?: Partial<AppState>): AppState {
    const fallback = createDefaultState()
    return {
      version: CURRENT_VERSION,
      watchlist: Array.isArray(partial?.watchlist) ? partial.watchlist : fallback.watchlist,
      settings: { ...fallback.settings, ...partial?.settings },
      activeCode: partial?.activeCode ?? fallback.activeCode
    }
  }

  private scheduleSave(): void {
    this.dirty = true
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      void this.write()
    }, SAVE_DEBOUNCE_MS)
  }

  private async write(): Promise<void> {
    const tmpPath = `${this.filePath}.tmp`
    try {
      await mkdir(dirname(this.filePath), { recursive: true })
      await writeFile(tmpPath, JSON.stringify(this.data, null, 2), 'utf-8')
      await rename(tmpPath, this.filePath)
      this.dirty = false
    } catch (error) {
      console.error('[store] 写入配置失败：', error)
    }
  }
}
