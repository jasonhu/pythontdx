/**
 * 多屏窗口放置的纯计算。
 *
 * Electron 的 workArea 已排除任务栏/顶栏；这里只做居中与负坐标（副屏在左侧/
 * 上方时 workArea.x/y 可能为负）处理，不修改窗口尺寸。
 */
export interface WindowBox {
  width: number
  height: number
}

export interface WorkArea {
  x: number
  y: number
  width: number
  height: number
}

export interface WindowPosition {
  x: number
  y: number
}

export function centerOnWorkArea(box: WindowBox, workArea: WorkArea): WindowPosition {
  const width = Math.max(1, Math.round(box.width))
  const height = Math.max(1, Math.round(box.height))
  return {
    x: Math.round(workArea.x + Math.max(0, (workArea.width - width) / 2)),
    y: Math.round(workArea.y + Math.max(0, (workArea.height - height) / 2))
  }
}
