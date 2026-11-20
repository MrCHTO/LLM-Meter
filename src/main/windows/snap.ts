/** 悬浮窗贴边与宽度锚点的纯计算，便于单测（不依赖 electron） */
export interface Area {
  x: number
  y: number
  width: number
  height: number
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** 吸附判定距离（像素） */
export const SNAP = 16

/** 离边不足阈值时贴到最近的那条边，x/y 各自独立判断 */
export function snapToEdges(next: Rect, area: Area, threshold = SNAP): Rect {
  let { x, y } = next
  const right = area.x + area.width - next.width
  const bottom = area.y + area.height - next.height
  const dx = [
    { d: Math.abs(x - area.x), v: area.x },
    { d: Math.abs(x - right), v: right }
  ].sort((a, b) => a.d - b.d)[0]
  if (dx !== undefined && dx.d <= threshold) x = dx.v
  const dy = [
    { d: Math.abs(y - area.y), v: area.y },
    { d: Math.abs(y - bottom), v: bottom }
  ].sort((a, b) => a.d - b.d)[0]
  if (dy !== undefined && dy.d <= threshold) y = dy.v
  return { ...next, x, y }
}

/**
 * 宽度变化后 x 的取法：贴着左边就保持左缘、贴着右边就保持右缘，
 * 否则以中心点为轴左右对称伸缩。
 */
export function anchorX(b: Rect, width: number, area: Area, threshold = SNAP): number {
  const leftGap = b.x - area.x
  const rightGap = area.x + area.width - (b.x + b.width)
  if (rightGap <= threshold && rightGap <= leftGap) return area.x + area.width - width
  if (leftGap <= threshold) return area.x
  return Math.round(b.x + (b.width - width) / 2)
}
