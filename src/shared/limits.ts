/**
 * 设置项的数值边界与默认值，只在这里定义。
 * 配置兜底、IPC 校验、界面输入上下限全部从这里取值。
 */

export interface NumRule {
  min: number
  max: number
  fallback: number
}

export const LIMITS = {
  port: { min: 1024, max: 65535, fallback: 8787 },
  usdCny: { min: 1, max: 20, fallback: 7.2 },
  retentionDays: { min: 1, max: 3650, fallback: 30 },
  rollupRetentionDays: { min: 1, max: 3650, fallback: 365 },
  overlayOpacity: { min: 10, max: 100, fallback: 100 },
  overlayWidth: { min: 240, max: 720, fallback: 320 },
  autoProbeIntervalSec: { min: 60, max: 3600, fallback: 300 }
} as const

export type LimitKey = keyof typeof LIMITS

/** 取整并钳进区间；非有限数回落默认值 */
export function clampInt(key: LimitKey, value: number): number {
  const rule = LIMITS[key]
  if (!Number.isFinite(value)) return rule.fallback
  return Math.min(rule.max, Math.max(rule.min, Math.round(value)))
}

/** 浮点钳制（汇率），保留 4 位 */
export function clampRate(value: number): number {
  if (!Number.isFinite(value)) return LIMITS.usdCny.fallback
  const clamped = Math.min(LIMITS.usdCny.max, Math.max(LIMITS.usdCny.min, value))
  return Math.round(clamped * 10000) / 10000
}
