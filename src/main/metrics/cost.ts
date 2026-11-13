import type { ModelCfg, RequestEvent } from '../../shared/types'

/**
 * 指标口径集中在这里，别在别处重复实现。
 *
 * 命中率 = 缓存读取 token / 输入 token 总量（输入已含缓存部分）
 * tok/s  = 输出 token / 生成窗口秒数；生成窗口 = 总耗时 - 首字耗时
 * 成本   = 未缓存输入×输入单价 + 输出×输出单价 + 缓存读取×缓存读取单价 + 缓存输入×缓存输入单价
 *          缓存读取/输入单价为 0 时按输入原价兜底，绝不免费
 *
 * 非流式没有首字时间，算不出速率，返回 null，界面标「仅总时长」。
 */
export interface Usage {
  input: number
  uncached: number
  output: number
  cacheRead: number
  cacheInput: number
}

export const EMPTY_USAGE: Usage = { input: 0, uncached: 0, output: 0, cacheRead: 0, cacheInput: 0 }

/** 把上游报的总量与读、写钳成互不重叠的四桶 */
export function normalizeUsage(input: number, cacheRead: number, cacheInput: number, output = 0): Usage {
  const total = Math.max(0, Math.round(input))
  const read = Math.min(Math.max(0, Math.round(cacheRead)), total)
  const written = Math.min(Math.max(0, Math.round(cacheInput)), total - read)
  return {
    input: total,
    uncached: total - read - written,
    output: Math.max(0, Math.round(output)),
    cacheRead: read,
    cacheInput: written
  }
}

export function hitRate(u: Usage): number | null {
  return u.input > 0 ? u.cacheRead / u.input : null
}

export function tps(output: number, durationMs: number, ttftMs: number | null): number | null {
  if (ttftMs === null || output <= 0) return null
  const windowSec = Math.max(0.001, (durationMs - ttftMs) / 1000)
  return output / windowSec
}

export function cost(model: Pick<ModelCfg, 'priceIn' | 'priceOut' | 'priceCacheRead' | 'priceCacheInput'>, u: Usage): number {
  const readPrice = model.priceCacheRead > 0 ? model.priceCacheRead : model.priceIn
  const writePrice = model.priceCacheInput > 0 ? model.priceCacheInput : model.priceIn
  const c =
    u.uncached * model.priceIn +
    u.output * model.priceOut +
    u.cacheRead * readPrice +
    u.cacheInput * writePrice
  return c / 1_000_000
}

export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`
  return String(Math.round(n))
}

export function fmtMoney(value: number, currency = 'CNY'): string {
  const symbol = currency === 'CNY' ? '¥' : currency === 'EUR' ? '€' : '$'
  return `${symbol}${value.toFixed(1)}`
}

export function fmtMs(ms: number | null): string {
  if (ms === null) return '—'
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

export function fmtPct(v: number | null): string {
  if (v === null) return '—'
  return `${Math.round(v * 100)}%`
}

export function summarize(ev: RequestEvent): string {
  const bits = [
    ev.ok ? 'ok' : 'fail',
    `${ev.inputTokens}/${ev.outputTokens}`,
    ev.ttftMs === null ? '非流式' : `${Math.round(ev.ttftMs)}ms`
  ]
  return bits.join(' · ')
}
