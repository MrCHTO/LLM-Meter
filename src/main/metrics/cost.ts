import type { ModelCfg, RequestEvent } from '../../shared/types'

/**
 * 指标口径集中在这里，别在别处重复实现。
 *
 * 命中率 = 缓存读 token / 输入 token 总量（输入已含缓存部分）
 * tok/s  = 输出 token / 生成窗口秒数；生成窗口 = 总耗时 - 首字耗时
 * 成本   = 未命中输入×输入单价 + 输出×输出单价 + 缓存读×缓存读单价 + 缓存写×缓存写单价
 *          「未命中输入」= 输入总量 − 缓存读 − 缓存写（缓存部分不再按原价重复计费）
 *
 * 非流式没有首字时间，算不出速率，返回 null，界面标「仅总时长」。
 */
export interface Usage {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

export const EMPTY_USAGE: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }

export function hitRate(u: Usage): number | null {
  return u.input > 0 ? u.cacheRead / u.input : null
}

export function tps(output: number, durationMs: number, ttftMs: number | null): number | null {
  if (ttftMs === null || output <= 0) return null
  const windowSec = Math.max(0.001, (durationMs - ttftMs) / 1000)
  return output / windowSec
}

export function cost(model: Pick<ModelCfg, 'priceIn' | 'priceOut' | 'priceCacheRead' | 'priceCacheWrite'>, u: Usage): number {
  const fullPriceInput = Math.max(0, u.input - u.cacheRead - u.cacheWrite)
  const c =
    fullPriceInput * model.priceIn +
    u.output * model.priceOut +
    u.cacheRead * model.priceCacheRead +
    u.cacheWrite * model.priceCacheWrite
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
