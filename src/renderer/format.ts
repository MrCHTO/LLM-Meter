export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`
  return String(Math.round(n))
}

export function symbolOf(currency: string): string {
  if (currency === 'CNY') return '¥'
  if (currency === 'EUR') return '€'
  if (currency === 'JPY') return '¥'
  return '$'
}

export function fmtMoney(value: number, currency = 'USD'): string {
  const s = symbolOf(currency)
  if (!value) return `${s}0`
  if (value < 0.01) return `${s}${value.toFixed(4)}`
  if (value < 1) return `${s}${value.toFixed(3)}`
  return `${s}${value.toFixed(2)}`
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

export function fmtClock(ts: number): string {
  const d = new Date(ts)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

export function classNames(...values: (string | false | null | undefined)[]): string {
  return values.filter(Boolean).join(' ')
}

export function budgetClass(ratio: number | null): '' | 'warn' | 'bad' {
  if (ratio === null) return ''
  if (ratio >= 1) return 'bad'
  if (ratio >= 0.8) return 'warn'
  return ''
}
