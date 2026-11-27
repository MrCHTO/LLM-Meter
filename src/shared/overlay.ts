import type { OverlayEffect } from './types'

/**
 * 各效果在胶囊四周留出的像素。
 *
 * 发光类要把光晕画出来，窗口得比胶囊大一圈；环类只需容下环本身。
 * 滑动层按它报窗口尺寸，设置页预览也用它保持同样比例。
 */
export const OVERLAY_EFFECT_PAD: Record<OverlayEffect, number> = {
  rainbow: 6,
  comet: 6,
  duo: 6,
  glow: 14,
  dot: 6
}
