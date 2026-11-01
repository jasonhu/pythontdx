/**
 * before-pack 的平台判定测试。
 *
 * 起源（2026-11-01）：Windows 上 Nuitka 产出 `python/dist/tdx-bridge.exe`，
 * 而脚本写死去找 `python/dist/tdx-bridge`，`npm run build:win` 必然报
 * “找不到 sidecar”。这条测试锁住文件名映射，避免再犯。
 */
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { sidecarFileName, sidecarPath } = require('./before-pack.cjs')

describe('before-pack 的 sidecar 路径', () => {
  it('Windows 找 .exe', () => {
    expect(sidecarFileName('win32')).toBe('tdx-bridge.exe')
    expect(sidecarPath('D:\\app', 'win32')).toBe(
      join('D:\\app', 'python', 'dist', 'tdx-bridge.exe')
    )
  })

  it('Linux / macOS 不带扩展名', () => {
    expect(sidecarFileName('linux')).toBe('tdx-bridge')
    expect(sidecarFileName('darwin')).toBe('tdx-bridge')
    expect(sidecarPath('/app', 'linux')).toBe(join('/app', 'python', 'dist', 'tdx-bridge'))
  })
})
