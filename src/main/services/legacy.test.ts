import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  migrateLegacyPortableData,
  migrateLegacyUserData,
  NEW_PORTABLE_DIR,
  NEW_STATE_FILE
} from './legacy'

const dirs: string[] = []
function temp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pythontdx-migrate-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('旧 StockLens 用户目录迁移', () => {
  it('复制旧配置与 localStorage，不删除旧目录', () => {
    const appData = temp()
    const old = join(appData, 'StockLens')
    mkdirSync(join(old, 'Local Storage', 'leveldb'), { recursive: true })
    writeFileSync(join(old, 'stocklens.json'), '{"state":{"activeCode":"sh600519"}}')
    writeFileSync(join(old, 'Local Storage', 'leveldb', '000001.log'), 'cache')

    const newDir = join(appData, 'pythontdx')
    const migrated = migrateLegacyUserData(appData, newDir)

    expect(migrated).toEqual([old])
    expect(readFileSync(join(newDir, NEW_STATE_FILE), 'utf8')).toContain('sh600519')
    expect(readFileSync(join(newDir, 'Local Storage', 'leveldb', '000001.log'), 'utf8')).toBe(
      'cache'
    )
    expect(readFileSync(join(old, 'stocklens.json'), 'utf8')).toContain('sh600519')
  })

  it('新配置已存在时不覆盖', () => {
    const appData = temp()
    const old = join(appData, 'stocklens')
    mkdirSync(old, { recursive: true })
    writeFileSync(join(old, 'stocklens.json'), 'old')
    const newDir = join(appData, 'pythontdx')
    mkdirSync(newDir, { recursive: true })
    writeFileSync(join(newDir, NEW_STATE_FILE), 'new')

    migrateLegacyUserData(appData, newDir)
    expect(readFileSync(join(newDir, NEW_STATE_FILE), 'utf8')).toBe('new')
  })

  it('便携版旧数据目录迁移到新目录', () => {
    const portable = temp()
    const old = join(portable, 'StockLens-data')
    mkdirSync(old, { recursive: true })
    writeFileSync(join(old, 'stocklens.json'), 'portable')
    const migrated = migrateLegacyPortableData(portable)

    expect(migrated).toEqual([old])
    expect(readFileSync(join(portable, NEW_PORTABLE_DIR, NEW_STATE_FILE), 'utf8')).toBe(
      'portable'
    )
  })
})
