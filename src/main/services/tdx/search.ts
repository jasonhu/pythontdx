/**
 * 兼容入口：搜索实现已移到 `src/shared/search.ts`。
 * 主进程与 Web 端共用同一份拼音索引与排序逻辑。
 */
export { buildSearchEntries, searchEntries } from '@shared/search'
export type { SearchEntry, SearchSecurity } from '@shared/search'
