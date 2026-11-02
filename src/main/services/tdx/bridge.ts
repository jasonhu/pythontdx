/**
 * Python 行情桥接进程的 TypeScript 管理器。
 *
 * 子进程只做三件事：TCP、协议解析、JSON Lines 输出。
 * 主进程负责：拉起/重启、请求排队、超时、错误中文化。
 *
 * 开发环境：
 *   python3 python/tdx_bridge.py
 * 打包环境：
 *   resources/tdx-bridge/tdx-bridge(.exe) —— 由 Nuitka 编译
 * 覆盖路径：
 *   PYTHONTDX_TDX_BRIDGE=/path/to/tdx-bridge
 *   PYTHONTDX_PYTHON=python3      （开发环境）
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createInterface, type Interface } from 'node:readline'
import { join } from 'node:path'
import { app } from 'electron'
import type { DataBackupProgress } from '@shared/types'

const PROGRESS_PREFIX = '__PYTHONTDX_PROGRESS__ '

function parseProgressLine(line: string): DataBackupProgress | null {
  if (!line.startsWith(PROGRESS_PREFIX)) return null
  try {
    const raw = JSON.parse(line.slice(PROGRESS_PREFIX.length)) as Partial<DataBackupProgress>
    if (
      (raw.operation === 'backup' || raw.operation === 'restore') &&
      (raw.phase === 'scan' ||
        raw.phase === 'write' ||
        raw.phase === 'hash' ||
        raw.phase === 'done') &&
      typeof raw.doneBytes === 'number' &&
      typeof raw.totalBytes === 'number' &&
      typeof raw.doneFiles === 'number' &&
      typeof raw.totalFiles === 'number' &&
      typeof raw.current === 'string'
    ) {
      return raw as DataBackupProgress
    }
  } catch {
    // 普通 stderr 或损坏的进度行，继续走日志分支
  }
  return null
}

export class TdxError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TdxError'
  }
}

interface Pending {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

interface BridgeMessage {
  id?: number
  ok?: boolean
  result?: unknown
  error?: string
}

const DEFAULT_TIMEOUT = 15_000
const STARTUP_TIMEOUT = 15_000
const CODE_LIST_TIMEOUT = 60_000
const QUOTES_TIMEOUT = 30_000

export class TdxBridge {
  private child: ChildProcessWithoutNullStreams | null = null
  private stdout: Interface | null = null
  private stderr: Interface | null = null
  private pending = new Map<number, Pending>()
  private progressListeners = new Set<(progress: DataBackupProgress) => void>()
  private nextId = 1
  private starting: Promise<void> | null = null
  private closed = false
  /**
   * 串行队列：协议是一问一答，桥接进程也按行处理。
   * 队列元素是「执行一次请求」的闭包；priority 请求插到队首，
   * 用于右下角逐笔这类必须尽快上屏的交互请求，避免排在自选迷你图后面。
   */
  private queue: Array<() => Promise<void>> = []
  private pumping = false

  /** 订阅 sidecar 的结构化进度（当前用于离线备份/恢复）；返回取消订阅函数 */
  onProgress(listener: (progress: DataBackupProgress) => void): () => void {
    this.progressListeners.add(listener)
    return () => {
      this.progressListeners.delete(listener)
    }
  }

  /** 通用请求；同一时刻只发一条，避免 stdout 行交错 */
  send<T>(
    cmd: string,
    payload: Record<string, unknown> = {},
    timeoutMs = DEFAULT_TIMEOUT,
    priority = false
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const run = async (): Promise<void> => {
        try {
          resolve(await this.sendNow<T>(cmd, payload, timeoutMs))
        } catch (error) {
          reject(error)
        }
      }
      if (priority) this.queue.unshift(run)
      else this.queue.push(run)
      this.pump()
    })
  }

  private pump(): void {
    if (this.pumping) return
    const run = this.queue.shift()
    if (!run) return
    this.pumping = true
    void run().finally(() => {
      this.pumping = false
      this.pump()
    })
  }

  close(): void {
    if (this.closed) return
    this.closed = true

    const child = this.child
    if (!child) return

    try {
      child.stdin.write(`${JSON.stringify({ id: 0, cmd: 'shutdown' })}\n`)
    } catch {
      // 进程已经退出，直接进入下面的 kill
    }

    setTimeout(() => {
      if (!child.killed) child.kill()
    }, 500).unref()

    this.failAll(new TdxError('行情桥接进程已关闭'))
    this.detach()
  }

  private async sendNow<T>(
    cmd: string,
    payload: Record<string, unknown>,
    timeoutMs: number
  ): Promise<T> {
    await this.ensureStarted()
    return this.sendRaw<T>(cmd, payload, timeoutMs)
  }

  private async ensureStarted(): Promise<void> {
    if (this.closed) throw new TdxError('行情桥接进程已关闭')
    if (this.child) return
    if (this.starting) return this.starting

    this.starting = this.startProcess()
      .then(async () => {
        await this.sendRaw<string>('ping', {}, STARTUP_TIMEOUT)
      })
      .catch((error: unknown) => {
        this.starting = null
        this.detach()
        throw error instanceof TdxError ? error : new TdxError('行情桥接进程启动失败')
      })

    return this.starting
  }

  private async startProcess(): Promise<void> {
    const { command, args, cwd } = resolveBridgeCommand()
    const child = spawn(command, args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env: {
        ...process.env,
        PYTHONIOENCODING: 'utf-8',
        PYTHONUNBUFFERED: '1'
      }
    })

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        child.kill()
        reject(new TdxError('行情桥接进程启动超时'))
      }, STARTUP_TIMEOUT)

      child.once('spawn', () => {
        clearTimeout(timer)
        resolve()
      })
      child.once('error', () => {
        clearTimeout(timer)
        reject(new TdxError('找不到 Python 或行情桥接程序，请检查安装'))
      })
    })

    this.child = child
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')

    this.stdout = createInterface({ input: child.stdout })
    this.stdout.on('line', (line) => this.onLine(line))

    this.stderr = createInterface({ input: child.stderr })
    this.stderr.on('line', (line) => {
      const progress = parseProgressLine(line)
      if (progress) {
        for (const listener of this.progressListeners) listener(progress)
        return
      }
      console.warn(`[tdx-bridge] ${line}`)
    })

    child.on('error', () => {
      this.failAll(new TdxError('行情桥接进程异常'))
      this.detach()
    })
    child.on('exit', () => {
      this.failAll(new TdxError('行情桥接进程已退出'))
      this.detach()
    })
  }

  private sendRaw<T>(cmd: string, payload: Record<string, unknown>, timeoutMs: number): Promise<T> {
    const child = this.child
    if (!child) return Promise.reject(new TdxError('行情桥接进程未启动'))

    const id = this.nextId
    this.nextId = this.nextId >= 0x7fffffff ? 1 : this.nextId + 1

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        // 超时说明桥接进程可能卡在 socket 上；直接杀掉，下一次请求会重启
        this.killChild()
        reject(new TdxError('行情服务器响应超时'))
      }, timeoutMs)

      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer })

      const line = `${JSON.stringify({ id, cmd, payload })}\n`
      child.stdin.write(line, (error) => {
        if (!error) return
        this.pending.delete(id)
        clearTimeout(timer)
        reject(new TdxError('行情请求发送失败'))
      })
    })
  }

  private onLine(line: string): void {
    let message: BridgeMessage
    try {
      message = JSON.parse(line) as BridgeMessage
    } catch {
      console.warn('[tdx-bridge] 忽略无法解析的输出')
      return
    }

    if (message.id === undefined) return
    const pending = this.pending.get(message.id)
    if (!pending) return

    this.pending.delete(message.id)
    clearTimeout(pending.timer)

    if (message.ok) pending.resolve(message.result)
    else pending.reject(new TdxError(message.error || '行情桥接进程返回未知错误'))
  }

  private failAll(error: Error): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer)
      pending.reject(error)
      this.pending.delete(id)
    }
  }

  private killChild(): void {
    const child = this.child
    if (child && !child.killed) child.kill()
    this.detach()
  }

  private detach(): void {
    this.stdout?.close()
    this.stderr?.close()
    this.stdout = null
    this.stderr = null
    this.child = null
    this.starting = null
  }
}

function resolveBridgeCommand(): { command: string; args: string[]; cwd: string } {
  const override = process.env.PYTHONTDX_TDX_BRIDGE
  if (override) {
    if (!existsSync(override)) throw new TdxError(`找不到行情桥接程序：${override}`)
    return { command: override, args: [], cwd: process.cwd() }
  }

  const executable = process.platform === 'win32' ? 'tdx-bridge.exe' : 'tdx-bridge'

  if (app.isPackaged) {
    const binary = join(process.resourcesPath, 'tdx-bridge', executable)
    if (!existsSync(binary)) {
      throw new TdxError('安装包缺少行情桥接程序，请重新安装')
    }
    return { command: binary, args: [], cwd: process.resourcesPath }
  }

  const cwd = app.getAppPath()
  const script = join(cwd, 'python', 'tdx_bridge.py')
  if (!existsSync(script)) throw new TdxError(`找不到行情桥接脚本：${script}`)

  const python =
    process.env.PYTHONTDX_PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3')
  return { command: python, args: [script], cwd }
}

export const CODE_LIST_TIMEOUT_MS = CODE_LIST_TIMEOUT
export const QUOTES_TIMEOUT_MS = QUOTES_TIMEOUT
