/**
 * 渲染进程入口。
 *
 * 样式在这里一次性引入，顺序很重要：
 *   tokens（变量） → base（重置） → components（通用组件） → app（业务布局）
 */
import { render } from 'solid-js/web'
import App from './App'
import './styles/tokens.css'
import './styles/base.css'
import './styles/components.css'
import './styles/app.css'

const container = document.getElementById('root')
if (!container) {
  throw new Error('找不到 #root 挂载点，请检查 index.html')
}

render(() => <App />, container)
