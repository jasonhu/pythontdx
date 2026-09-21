/**
 * 自选股列表（左栏）。
 */
import { For, type JSX } from 'solid-js'
import { appState } from '../stores/app'
import { IconStar } from './Icons'
import { WatchRow } from './WatchRow'

export function Sidebar(): JSX.Element {
  return (
    <aside class="sidebar">
      <div class="sidebar__head">
        <div class="sidebar__title">
          <IconStar size={12} />
          自选股
        </div>
        <span class="badge">{appState.watchlist.length}</span>
      </div>

      <div class="sidebar__list">
        <For each={appState.watchlist}>{(item) => <WatchRow item={item} />}</For>
      </div>

      <div class="sidebar__foot">
        数据来源 腾讯行情
        <br />
        行情有延迟，仅供参考，不构成投资建议
      </div>
    </aside>
  )
}
