/** 浏览器 / Electron 渲染层通用的文本下载；数据导出不经过主进程。 */
export function downloadText(
  filename: string,
  text: string,
  type = 'text/csv;charset=utf-8'
): void {
  const blob = new Blob([text], { type })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
