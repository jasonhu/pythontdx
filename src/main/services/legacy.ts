/**
 * 旧名兼容：把 `StockLens` / `stocklens` 的用户目录搬到 `pythontdx`。
 *
 * 项目 1.1 起正式改名，但用户可能已经积累了自选、设置和本地缓存；
 * 这里只做「复制缺失文件」，**不删除旧目录**，迁移失败也不影响启动。
 * 旧名只允许出现在这个文件里，其他地方一律用 pythontdx。
 */
import { cpSync, existsSync, mkdirSync, realpathSync } from 'node:fs'
import { join } from 'node:path'

export const LEGACY_APP_NAMES = ['StockLens', 'stocklens'] as const
export const LEGACY_STATE_FILE = 'stocklens.json'
export const NEW_STATE_FILE = 'pythontdx.json'
export const LEGACY_PORTABLE_DIR = 'StockLens-data'
export const NEW_PORTABLE_DIR = 'pythontdx-data'

/** 复制目录中不存在于目标位置的文件；同名的旧文件不覆盖新文件。 */
function copyMissing(from: string, to: string): void {
  if (!existsSync(from)) return
  try {
    mkdirSync(to, { recursive: true })
    cpSync(from, to, { recursive: true, force: false, errorOnExist: false })
  } catch (error) {
    console.warn(`[migrate] 复制旧用户目录失败：${from} -> ${to}`, error)
  }
}

/** 旧配置文件名 → 新配置文件名；目标已存在时保留新文件。 */
function copyState(newDir: string, oldDir: string): void {
  const source = join(oldDir, LEGACY_STATE_FILE)
  const target = join(newDir, NEW_STATE_FILE)
  if (!existsSync(source) || existsSync(target)) return
  try {
    mkdirSync(newDir, { recursive: true })
    cpSync(source, target)
  } catch (error) {
    console.warn(`[migrate] 迁移旧配置文件失败：${source} -> ${target}`, error)
  }
}

/**
 * 系统 userData：在 `%APPDATA%` / `~/.config` / `~/Library/Application Support`
 * 下查找旧目录，复制到新目录。
 */
export function migrateLegacyUserData(
  appDataDir: string,
  newUserDataDir: string
): string[] {
  const migrated: string[] = []
  const seen = new Set<string>()
  // new userData 已存在时通常只是重复启动，不再打印迁移日志；文件仍会补缺。
  const hadNewDir = existsSync(newUserDataDir)
  for (const name of LEGACY_APP_NAMES) {
    const oldDir = join(appDataDir, name)
    if (!existsSync(oldDir)) continue
    // Windows 大小写不敏感，StockLens / stocklens 可能指向同一个目录；只迁移一次。
    const real = realpathSync(oldDir)
    const key =
      process.platform === 'win32' || process.platform === 'darwin'
        ? real.toLowerCase()
        : real
    if (seen.has(key)) continue
    seen.add(key)
    copyMissing(oldDir, newUserDataDir)
    copyState(newUserDataDir, oldDir)
    if (!hadNewDir) migrated.push(oldDir)
  }
  return migrated
}

/** 便携版：旧 `StockLens-data` → 新 `pythontdx-data`，同样不删除旧目录。 */
export function migrateLegacyPortableData(portableDir: string): string[] {
  const oldDir = join(portableDir, LEGACY_PORTABLE_DIR)
  if (!existsSync(oldDir)) return []
  const newDir = join(portableDir, NEW_PORTABLE_DIR)
  copyMissing(oldDir, newDir)
  copyState(newDir, oldDir)
  return [oldDir]
}
