/**
 * 价格参考源，按优先级：
 * 1. models.dev 的官方条目（各厂商官方挂牌价，USD/百万 token）
 * 2. OpenRouter 各服务商里的最低价（页面卡片口径）
 * 都不需要任何 Key；查不到或超时由界面回落到手填。
 */
const ENDPOINT = 'https://openrouter.ai/api/v1/models'
const CATALOG = 'https://models.dev/api.json'
/** models.dev 里算作「官方」的厂商 key，按此顺序优先匹配 */
const OFFICIAL = ['deepseek', 'openai', 'anthropic', 'google', 'xai', 'alibaba', 'moonshotai', 'zhipuai']
const TTL_MS = 10 * 60_000
const TIMEOUT_MS = 6000
export const FAIL_NOTE = '连接openrouter超时，请手动填写'

export interface PriceLookup {
  found: boolean
  /** 命中是否精确（末段同名），否则为前缀/归一化后的近似命中 */
  exact?: boolean
  /** 命中的模型 id，便于核对 */
  matchedId?: string
  /** 价格来源 */
  source?: 'official' | 'openrouter'
  /** 每百万 token，USD */
  priceIn?: number
  priceOut?: number
  priceCacheRead?: number
  priceCacheInput?: number
  note: string
}

interface Entry {
  id: string
  tail: string
  compact: string
  priceIn: number
  priceOut: number
  priceCacheRead: number
  priceCacheInput: number
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
        priceCacheInput: num(pricing.input_cache_input) * 1e6
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

interface OfficialEntry extends Entry {
  provider: string
  nameCompact: string
}

let catalog: { at: number; list: OfficialEntry[] } | null = null

let catalogInflight: Promise<OfficialEntry[]> | null = null

/** models.dev 官方条目的目录，30 分钟缓存；并发调用共用一次请求 */
async function loadCatalog(): Promise<OfficialEntry[]> {
  if (catalog && Date.now() - catalog.at < 30 * 60_000) return catalog.list
  catalogInflight ??= fetchCatalog().finally(() => {
    catalogInflight = null
  })
  return catalogInflight
}

async function fetchCatalog(): Promise<OfficialEntry[]> {
  const controller = new AbortController()
  // api.json 有 6MB，启动忙时容易超 8 秒，给足 15 秒
  const timer = setTimeout(() => controller.abort(), 15_000)
  try {
    const res = await fetch(CATALOG, { signal: controller.signal, headers: { accept: 'application/json' } })
    if (!res.ok) return []
    const doc = (await res.json()) as Record<
      string,
      { models?: Record<string, { name?: string; cost?: Record<string, unknown> }> }
    >
    const list: OfficialEntry[] = []
    for (const provider of OFFICIAL) {
      const models = doc[provider]?.models ?? {}
      for (const [id, m] of Object.entries(models)) {
        const cost = m.cost ?? {}
        const priceIn = num(cost.input) * 1e0
        const priceOut = num(cost.output) * 1e0
        if (!priceIn && !priceOut) continue
        const name = typeof m.name === 'string' && m.name ? m.name : id
        list.push({
          provider,
          id,
          nameCompact: normalize(name).compact,
          ...normalize(id),
          priceIn,
          priceOut,
          priceCacheRead: num(cost.cache_read),
          priceCacheInput: num(cost.cache_input)
        })
      }
    }
    catalog = { at: Date.now(), list }
    return list
  } catch {
    return []
  } finally {
    clearTimeout(timer)
  }
}

/** 官方价优先：按 id、末段、名称归一化后匹配，命中即用 */
async function lookupOfficial(wanted: string): Promise<PriceLookup | null> {
  const list = await loadCatalog()
  if (list.length === 0) return null

  const { tail, compact } = normalize(wanted)
  const lower = wanted.toLowerCase()
  const shortest = (arr: OfficialEntry[]): OfficialEntry | undefined =>
    [...arr].sort((a, b) => a.nameCompact.length - b.nameCompact.length)[0]

  const hit =
    list.find((e) => e.id.toLowerCase() === lower) ??
    list.find((e) => e.tail === tail) ??
    list.find((e) => e.compact === compact) ??
    list.find((e) => e.nameCompact === compact) ??
    shortest(list.filter((e) => e.nameCompact.startsWith(compact))) ??
    shortest(list.filter((e) => e.compact.startsWith(compact)))
  if (!hit) return null

  const exact = hit.id.toLowerCase() === lower || hit.tail === tail || hit.nameCompact === compact
  return {
    found: true,
    exact,
    matchedId: `${hit.provider}/${hit.id}`,
    source: 'official',
    priceIn: round(hit.priceIn),
    priceOut: round(hit.priceOut),
    priceCacheRead: round(hit.priceCacheRead),
    priceCacheInput: round(hit.priceCacheInput),
    note: hit.id
  }
}

const ENDPOINT_TTL_MS = 10 * 60_000
const endpointCache = new Map<string, { at: number; p: Entry }>()

/**
 * 顶层 pricing 是「代表价」，页面卡片展示的是最便宜服务商的价格。
 * 拉 endpoints 列表，取所有服务商里输入价最低的一档，跟页面口径一致。
 */
async function cheapestEndpoint(id: string): Promise<Entry | null> {
  const cached = endpointCache.get(id)
  if (cached && Date.now() - cached.at < ENDPOINT_TTL_MS) return cached.p

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(`https://openrouter.ai/api/v1/models/${id}/endpoints`, {
      signal: controller.signal,
      headers: { accept: 'application/json' }
    })
    if (!res.ok) return null
    const json = (await res.json()) as {
      data?: { endpoints?: { pricing?: Record<string, unknown> }[] }
    }
    let best: Entry | null = null
    for (const ep of json.data?.endpoints ?? []) {
      const p = ep.pricing ?? {}
      const priceIn = num(p.prompt) * 1e6
      const priceOut = num(p.completion) * 1e6
      if (!priceIn && !priceOut) continue
      const entry: Entry = {
        id,
        ...normalize(id),
        priceIn,
        priceOut,
        priceCacheRead: num(p.input_cache_read) * 1e6,
        priceCacheInput: num(p.input_cache_input) * 1e6
      }
      if (!best || entry.priceIn < best.priceIn) best = entry
    }
    if (best) endpointCache.set(id, { at: Date.now(), p: best })
    return best
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

export async function lookup(modelId: string): Promise<PriceLookup> {
  const wanted = modelId.trim()
  if (!wanted) return { found: false, note: '先填上游模型名' }

  const official = await lookupOfficial(wanted)
  if (official) return official

  let list: Entry[]
  try {
    list = await load()
  } catch {
    return { found: false, note: FAIL_NOTE }
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

  if (!hit) return { found: false, note: FAIL_NOTE }

  const wanted_lc = wanted.toLowerCase()
  const exact = hit.id.toLowerCase() === wanted_lc || hit.tail === tail
  const price = (await cheapestEndpoint(hit.id)) ?? hit

  return {
    found: true,
    exact,
    matchedId: hit.id,
    source: 'openrouter',
    priceIn: round(price.priceIn),
    priceOut: round(price.priceOut),
    priceCacheRead: round(price.priceCacheRead),
    priceCacheInput: round(price.priceCacheInput),
    note: hit.id
  }
}
