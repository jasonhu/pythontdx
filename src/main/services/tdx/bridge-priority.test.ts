/**
 * 桥接请求队列：priority 请求必须插到队首。
 *
 * 逐笔面板首屏慢，一部分原因是它排在自选迷你图/历史 K 的请求后面；
 * 这里不碰真实 Python 进程，只验证队列顺序。
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => process.cwd()
  }
}))

import { TdxBridge } from './bridge'

type Internals = { sendNow: (cmd: string) => Promise<unknown> }

function fakeBridge(): { bridge: TdxBridge; calls: string[] } {
  const bridge = new TdxBridge()
  const calls: string[] = []
  ;(bridge as unknown as Internals).sendNow = async (cmd: string) => {
    calls.push(cmd)
    await new Promise((resolve) => setTimeout(resolve, 0))
    return cmd
  }
  return { bridge, calls }
}

describe('TdxBridge priority queue', () => {
  it('普通请求保持先进先出', async () => {
    const { bridge, calls } = fakeBridge()
    const first = bridge.send('a')
    const second = bridge.send('b')
    await Promise.all([first, second])
    expect(calls).toEqual(['a', 'b'])
    bridge.close()
  })

  it('priority 请求插到尚未执行的队首', async () => {
    const { bridge, calls } = fakeBridge()
    const first = bridge.send('a')
    const normal = bridge.send('b')
    const urgent = bridge.send('c', {}, 1000, true)
    const results = await Promise.all([first, normal, urgent])
    expect(calls).toEqual(['a', 'c', 'b'])
    expect(results).toEqual(['a', 'b', 'c'])
    bridge.close()
  })
})
