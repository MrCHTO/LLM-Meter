import * as cfg from './store/config'
import { dayKey } from '../shared/date'

/**
 * 美元换人民币：每天取一次最新价并记住当天结果，
 * 取不到（断网/接口挂）就沿用上次的值，绝不让查价失败。
 */
const SOURCES = [
  {
    url: 'https://open.er-api.com/v6/latest/USD',
    pick: (json: Record<string, unknown>): number => {
      const rates = json.rates as Record<string, unknown> | undefined
      return Number(rates?.CNY ?? 0)
    }
  },
  {
    url: 'https://api.frankfurter.app/latest?from=USD&to=CNY',
    pick: (json: Record<string, unknown>): number => {
      const rates = json.rates as Record<string, unknown> | undefined
      return Number(rates?.CNY ?? 0)
    }
  }
]

const TIMEOUT_MS = 4000
const MIN = 1
const MAX = 20

let inflight: Promise<number> | null = null

function sane(v: number): number {
  return Number.isFinite(v) && v >= MIN && v <= MAX ? Math.round(v * 10000) / 10000 : 0
}

async function fetchFresh(): Promise<number> {
  for (const source of SOURCES) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    try {
      const res = await fetch(source.url, { signal: controller.signal, headers: { accept: 'application/json' } })
      if (!res.ok) continue
      const value = sane(source.pick((await res.json()) as Record<string, unknown>))
      if (value) return value
    } catch {
      /* 换下一个源 */
    } finally {
      clearTimeout(timer)
    }
  }
  return 0
}

/** 当天汇率；已经取过就直接用缓存 */
export async function current(): Promise<{ rate: number; date: string; fresh: boolean }> {
  const settings = cfg.get().settings
  const today = dayKey()
  if (settings.usdCnyDate === today && settings.usdCny > 0) {
    return { rate: settings.usdCny, date: settings.usdCnyDate, fresh: false }
  }

  inflight ??= fetchFresh().finally(() => {
    inflight = null
  })
  const value = await inflight

  if (value) {
    cfg.mutate((c) => {
      c.settings.usdCny = value
      c.settings.usdCnyDate = today
    })
    return { rate: value, date: today, fresh: true }
  }
  return { rate: settings.usdCny, date: settings.usdCnyDate, fresh: false }
}

/** 手动重取，忽略当天缓存 */
export async function refresh(): Promise<{ rate: number; date: string; fresh: boolean }> {
  cfg.mutate((c) => {
    c.settings.usdCnyDate = ''
  })
  return current()
}
