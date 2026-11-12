/**
 * 按模型 id 去 OpenRouter 查公开价，查到就带回来当参考值。
 * 只查公开列表，不需要任何 Key；查不到或超时由界面回落到手填。
 */
const ENDPOINT = 'https://openrouter.ai/api/v1/models'
const TTL_MS = 10 * 60_000
const TIMEOUT_MS = 6000

export interface PriceLookup {
  found: boolean
  /** 命中是否精确（末段同名），否则为前缀/归一化后的近似命中 */
  exact?: boolean
  /** 命中的 OpenRouter 模型 id，便于核对 */
  matchedId?: string
  /** 每百万 token，USD */
  priceIn?: number
  priceOut?: number
  priceCacheRead?: number
  priceCacheWrite?: number
  note: string
}

interface Entry {
  id: string
  tail: string
  compact: string
  priceIn: number
  priceOut: number
  priceCacheRead: number
  priceCacheWrite: number
}

let cache: { at: number; list: Entry[] } | null = null

const num = (v: unknown): number => {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : 0
  return Number.isFinite(n) && n > 0 ? n : 0
}

function normalize(id: string): { tail: string; compact: string } {
  const lower = id.trim().toLowerCase()
  const tail = lower.includes('/') ? lower.slice(lower.lastIndexOf('/') + 1) : lower
  return { tail, compact: tail.replace(/[-_.\s]/g, '') }
}

async function load(): Promise<Entry[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.list

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(ENDPOINT, { signal: controller.signal, headers: { accept: 'application/json' } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json: unknown = await res.json()
    const data = (json as { data?: unknown }).data
    const list: Entry[] = []
    for (const raw of Array.isArray(data) ? data : []) {
      if (!raw || typeof raw !== 'object') continue
      const item = raw as Record<string, unknown>
      if (typeof item.id !== 'string') continue
      const pricing = (item.pricing ?? {}) as Record<string, unknown>
      // OpenRouter 给的是「每 token 的美元价」，换成每百万 token
      const entry: Entry = {
        id: item.id,
        ...normalize(item.id),
        priceIn: num(pricing.prompt) * 1e6,
        priceOut: num(pricing.completion) * 1e6,
        priceCacheRead: num(pricing.input_cache_read) * 1e6,
        priceCacheWrite: num(pricing.input_cache_write) * 1e6
      }
      if (entry.priceIn || entry.priceOut) list.push(entry)
    }
    cache = { at: Date.now(), list }
    return list
  } finally {
    clearTimeout(timer)
  }
}

const round = (n: number): number => Math.round(n * 1e6) / 1e6

export async function lookup(modelId: string): Promise<PriceLookup> {
  const wanted = modelId.trim()
  if (!wanted) return { found: false, note: '先填上游模型名' }

  let list: Entry[]
  try {
    list = await load()
  } catch (err) {
    const timeout = (err as Error).name === 'AbortError'
    return { found: false, note: timeout ? 'OpenRouter 超时，请手填' : 'OpenRouter 不可达，请手填' }
  }

  const { tail, compact } = normalize(wanted)
  // :batch / :free 这类变体排后面，优先基础版
  const plain = list.filter((e) => !e.id.includes(':'))
  const byTailLen = (a: Entry, b: Entry): number => a.tail.length - b.tail.length

  const hit =
    list.find((e) => e.id.toLowerCase() === wanted.toLowerCase()) ??
    plain.find((e) => e.tail === tail) ??
    plain.find((e) => e.compact === compact) ??
    [...plain.filter((e) => e.tail.startsWith(tail))].sort(byTailLen)[0] ??
    [...plain.filter((e) => e.compact.startsWith(compact))].sort(byTailLen)[0] ??
    [...list.filter((e) => e.tail === tail)].sort(byTailLen)[0]

  if (!hit) return { found: false, note: `OpenRouter 没有 ${wanted}，请手填` }

  const wanted_lc = wanted.toLowerCase()
  const exact = hit.id.toLowerCase() === wanted_lc || hit.tail === tail

  return {
    found: true,
    exact,
    matchedId: hit.id,
    priceIn: round(hit.priceIn),
    priceOut: round(hit.priceOut),
    priceCacheRead: round(hit.priceCacheRead),
    priceCacheWrite: round(hit.priceCacheWrite),
    note: exact ? `已按 ${hit.id} 填写` : `近似匹配 ${hit.id}，请核对价格`
  }
}
