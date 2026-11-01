/**
 * Web 版本号不能写死。
 *
 * 回归来源：0.13.2 的 Linux 验证发现 Web 右下角仍是 `v0.7.0-web`。
 * 这里锁住「构建注入的版本 == package.json 版本 + -web」，避免再次漂移。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { WEB_VERSION } from '../src/web/version'

describe('Web 版本号', () => {
  it('跟随 package.json 的版本，而不是写死', () => {
    const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'))
    expect(WEB_VERSION).toBe(`${pkg.version}-web`)
  })
})
