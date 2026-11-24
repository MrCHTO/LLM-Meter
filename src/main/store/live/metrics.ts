import type { ModelState } from './types'
import { COEF_CJK, COEF_OTHER, DELTA_WINDOW_MS, TPS_WINDOW, TTFT_SAMPLES_MAX } from './types'

export function coefOf(s: ModelState): { cjk: number; other: number } {
  if (s.calibEst <= 0) return { cjk: COEF_CJK, other: COEF_OTHER }
  // 先验 20 token，避免第一条请求把系数带飞
  const ratio = Math.min(3, Math.max(0.5, (s.calibObs + 20) / (s.calibEst + 20)))
  return { cjk: COEF_CJK / ratio, other: COEF_OTHER / ratio }
}

/** 流式增量到达：记样本与秒桶，供胶囊和曲线显示估算速率 */
export function realtimeOf(s: ModelState, now: number): number | null {
  if (s.genStart === null) return null
  while (s.deltaSamples.length && (s.deltaSamples[0] as { ts: number }).ts < now - DELTA_WINDOW_MS) {
    s.deltaSamples.shift()
  }
  const sum = s.deltaSamples.reduce((a, b) => a + b.tokens, 0)
  const span = Math.min(DELTA_WINDOW_MS, Math.max(500, now - s.genStart)) / 1000
  return sum / span
}

export function pushTtftSample(s: ModelState, ms: number): void {
  s.ttftSamples.push(ms)
  if (s.ttftSamples.length > TTFT_SAMPLES_MAX) s.ttftSamples.shift()
}

/** 最近邻法分位数，无样本返回 null */
export function ttftPct(samples: number[], p: number): number | null {
  if (samples.length === 0) return null
  const sorted = [...samples].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return Math.round(sorted[Math.max(0, idx)] ?? sorted[sorted.length - 1] ?? 0)
}

export function tpsOf(s: ModelState): number {
  const tail = s.buckets.slice(-TPS_WINDOW)
  return tail.reduce((a, b) => a + b, 0) / TPS_WINDOW
}
