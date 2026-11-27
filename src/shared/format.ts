/**
 * 展示用格式化。主进程与渲染进程共用同一套，精度只有这里说了算。
 */

export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`
  return String(Math.round(n))
}

/** 用量统计用的中文计数：万 / 亿 */
export function fmtWan(n: number): string {
  if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(2)}亿`
  if (n >= 10_000) return `${(n / 10_000).toFixed(1)}万`
  return String(Math.round(n))
}

function symbolOf(currency: string): string {
  if (currency === 'CNY' || currency === 'JPY') return '¥'
  if (currency === 'EUR') return '€'
  return '$'
}

export function fmtMoney(value: number, currency = 'CNY'): string {
  return `${symbolOf(currency)}${value.toFixed(1)}`
}

export function fmtMs(ms: number | null): string {
  if (ms === null) return '—'
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

export function fmtPct(v: number | null): string {
  if (v === null) return '—'
  return `${(v * 100).toFixed(2)}%`
}
