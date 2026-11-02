/**
 * Python 桥接进程管理器测试。
 *
 * 只验证「拉起子进程 + JSON Lines 一问一答」这一段，不访问行情主站：
 * 用一个 shell wrapper 把 tdx_bridge.py 包成可执行文件，然后 ping。
 * Windows 上 .sh wrapper 不可执行，直接跳过（打包后的 exe 由人工验证）。
 */
import { chmodSync, existsSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => process.cwd()
  }
}))

const script = join(process.cwd(), 'python', 'tdx_bridge.py')
const wrapper = join(tmpdir(), `pythontdx-tdx-bridge-${process.pid}.sh`)

describe.skipIf(process.platform === 'win32')('TdxBridge', () => {
  afterAll(() => {
    if (existsSync(wrapper)) unlinkSync(wrapper)
    delete process.env.PYTHONTDX_TDX_BRIDGE
  })

  it('拉起 Python 子进程并完成 ping', async () => {
    const python = process.env.PYTHONTDX_PYTHON ?? 'python3'
    writeFileSync(wrapper, `#!/bin/sh\nexec "${python}" "${script}"\n`)
    chmodSync(wrapper, 0o755)
    process.env.PYTHONTDX_TDX_BRIDGE = wrapper

    const { TdxBridge } = await import('./bridge')
    const bridge = new TdxBridge()

    try {
      await expect(bridge.send('ping')).resolves.toBe('pong')
    } finally {
      bridge.close()
    }
  }, 20_000)
})
