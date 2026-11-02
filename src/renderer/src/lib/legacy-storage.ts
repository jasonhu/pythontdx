/**
 * 旧 localStorage key 迁移。
 *
 * 1.1 起品牌从 StockLens 改为 pythontdx；自选/设置由主进程 JSON 管理，
 * 但报价快照、分时快照、Web 状态仍在 localStorage。这里把旧前缀复制到新前缀，
 * 不删除旧键，保证降级或回滚时仍能读到。
 */
const LEGACY_PREFIXES = ['stocklens', 'StockLens'] as const
const NEW_PREFIX = 'pythontdx'

export function migrateLegacyLocalStorage(): number {
  if (typeof localStorage === 'undefined') return 0
  let migrated = 0
  try {
    const keys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
    for (const key of keys) {
      if (!key) continue
      const prefix = LEGACY_PREFIXES.find((item) => key.startsWith(item))
      if (!prefix) continue
      const next = `${NEW_PREFIX}${key.slice(prefix.length)}`
      if (localStorage.getItem(next) !== null) continue
      const value = localStorage.getItem(key)
      if (value === null) continue
      localStorage.setItem(next, value)
      migrated += 1
    }
  } catch {
    // 隐私模式/配额不足：不让迁移阻断启动。
  }
  if (migrated > 0) console.info(`[storage] 已迁移 ${migrated} 个旧 localStorage 键`)
  return migrated
}
