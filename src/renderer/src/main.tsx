/**
 * 渲染进程入口。
 *
 * 样式在这里一次性引入，顺序很重要：
 *   tokens（变量） → base（重置） → components（通用组件） → app（业务布局）
 */
import { render } from 'solid-js/web'
import App from './App'
import { DetachedChart } from './components/DetachedChart'
import { migrateLegacyLocalStorage } from './lib/legacy-storage'
import './styles/tokens.css'
import './styles/base.css'
import './styles/components.css'
import './styles/app.css'

// 旧 StockLens 的报价/分时快照 key 先复制到 pythontdx 前缀。
migrateLegacyLocalStorage()

const container = document.getElementById('root')
if (!container) {
  throw new Error('找不到 #root 挂载点，请检查 index.html')
}

const params = new URLSearchParams(window.location.search)
const detached = params.get('detached')
// 独立分时图窗口不套主窗口的最小尺寸，避免被撑出横向滚动条
document.documentElement.dataset.window = detached ?? 'main'
const detachedCode = detached === 'chart' ? params.get('code') : null

render(
  () =>
    detachedCode ? <DetachedChart code={detachedCode} /> : <App />,
  container
)
