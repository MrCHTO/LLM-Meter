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

/** 贴边判定距离（像素），只影响换宽时靠左还是靠右收放 */
export const SNAP = 16

/** 中线吸附判定距离（像素） */
export const CENTER_SNAP = 14

/** 拖动或定位时靠近屏幕横/纵中线就吸附，两轴独立判定 */
export function snapCenter(b: Rect, area: Area, threshold = CENTER_SNAP): { x: number; y: number } {
  const cx = b.x + b.width / 2
  const cy = b.y + b.height / 2
  const ax = area.x + area.width / 2
  const ay = area.y + area.height / 2
  return {
    x: Math.abs(cx - ax) <= threshold ? Math.round(ax - b.width / 2) : b.x,
    y: Math.abs(cy - ay) <= threshold ? Math.round(ay - b.height / 2) : b.y
  }
}

/**
 * 宽度变化后 x 的取法：贴着左边就保持左缘、贴着右边就保持右缘，
 * 否则按调用方保存的中心点（浮点）反推，避免按整数边界反复取整向右漂。
 */
export function anchorX(b: Rect, width: number, area: Area, center: number, threshold = SNAP): number {
  const leftGap = b.x - area.x
  const rightGap = area.x + area.width - (b.x + b.width)
  if (rightGap <= threshold && rightGap <= leftGap) return area.x + area.width - width
  if (leftGap <= threshold) return area.x
  return Math.round(center - width / 2)
}
