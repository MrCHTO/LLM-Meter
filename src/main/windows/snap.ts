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
