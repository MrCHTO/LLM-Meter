import type {
  DayPoint,
  LiveSnapshot,
  ModelLive,
  RequestEvent,
  SnapshotTotals,
  TodayTotals
} from '../../shared/types'
import * as cfg from './config'
import * as rollup from './rollup'

const BUCKETS = 60
const RECENT_MAX = 200
const TPS_WINDOW = 10

interface ModelState {
  buckets: number[]
  bucketSecond: number
  today: TodayTotals
  lastError: string | null
  lastErrorAt: number | null
  lastTtftMs: number | null
  probing: boolean
}

const state = new Map<string, ModelState>()
const recent: RequestEvent[] = []

function blankToday(): TodayTotals {
  return { requests: 0, errors: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 }
}

function ensure(modelId: string): ModelState {
  const found = state.get(modelId)
  if (found) return found
  const created: ModelState = {
    buckets: new Array<number>(BUCKETS).fill(0),
    bucketSecond: Math.floor(Date.now() / 1000),
    today: blankToday(),
    lastError: null,
    lastErrorAt: null,
    lastTtftMs: null,
    probing: false
  }
  state.set(modelId, created)
  return created
}

function rollBuckets(s: ModelState, now = Date.now()): void {
  const sec = Math.floor(now / 1000)
  const shift = sec - s.bucketSecond
  if (shift <= 0) return
  if (shift >= BUCKETS) {
    s.buckets.fill(0)
  } else {
    s.buckets = [...s.buckets.slice(shift), ...new Array<number>(shift).fill(0)]
  }
  s.bucketSecond = sec
}

export function init(): void {
  const now = Date.now()
  cfg.mutate((c) => {
    for (const m of c.models) {
      const s = ensure(m.id)
      const t = rollup.todayTotals(m.id)
      s.today = {
        requests: t.req,
        errors: t.err,
        input: t.input,
        output: t.out,
        cacheRead: t.cacheRead,
        cacheWrite: t.cacheWrite,
        cost: t.cost
      }
      rollBuckets(s, now)
    }
  })
}

/** 回放最近 15 分钟，让重启后曲线不空。 */
export function replay(events: RequestEvent[]): void {
  const from = Date.now() - 15 * 60_000
  for (const ev of events) {
    if (ev.ts < from || !ev.ok) continue
    const s = ensure(ev.modelId)
    rollBuckets(s, ev.ts)
    const idx = BUCKETS - 1
    s.buckets[idx] = (s.buckets[idx] ?? 0) + ev.outputTokens
    if (ev.ttftMs !== null) s.lastTtftMs = ev.ttftMs
  }
}

export function record(ev: RequestEvent): void {
  const s = ensure(ev.modelId)
  rollBuckets(s, ev.ts)
  if (ev.ok) {
    s.today.requests += 1
    s.today.input += ev.inputTokens
    s.today.output += ev.outputTokens
    s.today.cacheRead += ev.cacheReadTokens
    s.today.cacheWrite += ev.cacheWriteTokens
    s.today.cost += ev.cost
    if (ev.ttftMs !== null) s.lastTtftMs = ev.ttftMs
    const idx = BUCKETS - 1
    s.buckets[idx] = (s.buckets[idx] ?? 0) + ev.outputTokens
  } else {
    s.today.requests += 1
    s.today.errors += 1
    s.lastError = describe(ev)
    s.lastErrorAt = ev.ts
  }
  recent.unshift(ev)
  if (recent.length > RECENT_MAX) recent.length = RECENT_MAX
}

function describe(ev: RequestEvent): string {
  const label: Record<string, string> = {
    auth: '本地 token 不对',
    not_found: '未登记的模型',
    model_disabled: '模型已停用',
    timeout: '上游超时',
    aborted: '客户端取消',
    upstream_4xx: '上游 4xx',
    upstream_5xx: '上游 5xx',
    network: '网络失败',
    parse: '响应解析失败',
    unsupported: '不支持的路径'
  }
  const b = ev.errorKind ? label[ev.errorKind] : undefined
  return `${b ?? '失败'}${ev.status ? ` (${ev.status})` : ''}`
}

export function setProbing(modelId: string, value: boolean): void {
  ensure(modelId).probing = value
}

export function recentFor(modelId: string, limit = 20): RequestEvent[] {
  return recent.filter((e) => e.modelId === modelId).slice(0, limit)
}

export function tpsOf(s: ModelState): number {
  const tail = s.buckets.slice(-TPS_WINDOW)
  return tail.reduce((a, b) => a + b, 0) / TPS_WINDOW
}

export function snapshot(proxyRunning: boolean, proxyError: string | null, baseUrl: string): LiveSnapshot {
  const now = Date.now()
  const settings = cfg.get().settings
  const providers = new Map(cfg.listProviders().map((p) => [p.id, p]))

  const models: ModelLive[] = []
  const totals: SnapshotTotals = {
    tps: 0,
    hitRate: null,
    todayCost: 0,
    requests: 0,
    errors: 0,
    budgetRatio: null,
    budgetSum: 0,
    currency: 'USD'
  }

  for (const m of cfg.listModels()) {
    const s = ensure(m.id)
    rollBuckets(s, now)
    const provider = providers.get(m.providerId)
    const tps = tpsOf(s)
    const hitRate = s.today.input > 0 ? s.today.cacheRead / s.today.input : null
    const budgetRatio = m.dailyBudget && m.dailyBudget > 0 ? s.today.cost / m.dailyBudget : null
    models.push({
      modelId: m.id,
      alias: m.alias,
      providerName: provider?.name ?? '（供应商已删）',
      baseUrl: provider?.baseUrl ?? '',
      format: provider?.format ?? 'openai',
      currency: m.currency,
      dailyBudget: m.dailyBudget,
      watch: m.watch,
      buckets: [...s.buckets],
      tps,
      hitRate,
      today: { ...s.today },
      budgetRatio,
      lastError: s.lastError,
      lastErrorAt: s.lastErrorAt,
      lastTtftMs: s.lastTtftMs,
      probing: s.probing,
      paused: settings.pauseProbe
    })
    totals.tps += tps
    totals.todayCost += s.today.cost
    totals.requests += s.today.requests
    totals.errors += s.today.errors
    totals.currency = m.currency
    if (m.dailyBudget) totals.budgetSum += m.dailyBudget
  }

  const inputTotal = models.reduce((a, x) => a + x.today.input, 0)
  const cacheTotal = models.reduce((a, x) => a + x.today.cacheRead, 0)
  totals.hitRate = inputTotal > 0 ? cacheTotal / inputTotal : null
  if (totals.budgetSum > 0) totals.budgetRatio = totals.todayCost / totals.budgetSum

  return {
    ts: now,
    proxyRunning,
    proxyError,
    baseUrl,
    models: models.filter((m) => cfg.modelById(m.modelId)?.enabled !== false),
    totals
  }
}

export function overlayModels(): ModelLive[] {
  const snap = snapshot(false, null, '')
  return snap.models.filter((m) => {
    const model = cfg.modelById(m.modelId)
    return model?.watch === true && model.enabled
  })
}

export function liveOf(modelId: string): ModelLive | undefined {
  return snapshot(false, null, '').models.find((m) => m.modelId === modelId)
}

export function emptyDays(days: number): DayPoint[] {
  const out: DayPoint[] = []
  const now = Date.now()
  for (let i = days - 1; i >= 0; i--) {
    out.push({ ts: new Date(new Date(now - i * 86400_000).setHours(0, 0, 0, 0)).getTime(), out: 0, req: 0, err: 0, cost: 0 })
  }
  return out
}
