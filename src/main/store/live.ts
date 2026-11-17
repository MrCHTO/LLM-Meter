import type {
  DayPoint,
  LiveSnapshot,
  ModelLive,
  RequestEvent,
  SnapshotTotals,
  TodayTotals
} from '../../shared/types'
import * as cfg from './config'
import * as db from './db'
import { tps } from '../metrics/cost'
import * as repo from './db/repo'
import { dayKey } from './paths'

/** 曲线窗口秒数：每格 1 秒，3 分钟 */
export const BUCKETS = 180
const RECENT_MAX = 200
/** tok/s 按 1 秒窗口：最近 1 秒桶里的输出 token 数 */
const TPS_WINDOW = 1
/** 实时速率窗口：只看最近 2 秒的增量估算 */
const DELTA_WINDOW_MS = 2000
/** 中文/英文每 token 的字符数默认值，会按完成请求的真实 usage 校正 */
const COEF_CJK = 1.7
const COEF_OTHER = 3.8
/** TTFT 分位数的样本上限，够估 P99 又不至于无限涨 */
const TTFT_SAMPLES_MAX = 500

interface ModelState {
  buckets: number[]
  /** 每秒请求数，供请求曲线用 */
  reqBuckets: number[]
  bucketSecond: number
  today: TodayTotals
  lastError: string | null
  lastErrorAt: number | null
  lastTtftMs: number | null
  lastTps: number | null
  lastTpsAt: number | null
  /** 今天的 TTFT 样本，重启时从明细回灌 */
  ttftSamples: number[]
  probing: boolean
  probeFails: number
  lastProbeAt: number | null
  lastProbeOk: boolean | null
  /** 流式增量样本，用于实时估算速率 */
  deltaSamples: { ts: number; tokens: number }[]
  /** 每秒估算 token，供多模型实时曲线 */
  deltaBuckets: number[]
  deltaSecond: number
  /** 当前生成开始时间；首字前为 null */
  genStart: number | null
  /** 本次生成累计的中英字符与默认估算量，结束后用于校正系数 */
  genCjk: number
  genOther: number
  genEst: number
  /** 已观察的真实输出 token 与真实字符，系数随完成请求收敛 */
  calibObs: number
  calibEst: number
}

const state = new Map<string, ModelState>()
const recent: RequestEvent[] = []
/** 进行中的请求数，驱动胶囊彩虹边框 */
const inflight = new Map<string, number>()
/** 请求开始后至少亮这么久，避免连发时频闪；结束后不再额外保持 */
const visibleUntil = new Map<string, number>()
const MIN_VISIBLE_MS = 1500

export function begin(modelId: string): void {
  inflight.set(modelId, (inflight.get(modelId) ?? 0) + 1)
  visibleUntil.set(modelId, Math.max(visibleUntil.get(modelId) ?? 0, Date.now() + MIN_VISIBLE_MS))
}

export function end(modelId: string): void {
  const left = (inflight.get(modelId) ?? 1) - 1
  if (left > 0) {
    inflight.set(modelId, left)
    return
  }
  inflight.delete(modelId)
  const s = state.get(modelId)
  if (s && left <= 0) s.genStart = null
}

/** 当前模型的 token 估算系数（字符/token），随完成请求向真实比例收敛 */
function coefOf(s: ModelState): { cjk: number; other: number } {
  if (s.calibEst <= 0) return { cjk: COEF_CJK, other: COEF_OTHER }
  // 先验 20 token，避免第一条请求把系数带飞
  const ratio = Math.min(3, Math.max(0.5, (s.calibObs + 20) / (s.calibEst + 20)))
  return { cjk: COEF_CJK / ratio, other: COEF_OTHER / ratio }
}

/** 流式增量到达：记样本与秒桶，供胶囊和曲线显示估算速率 */
export function noteDelta(modelId: string, cjk: number, other: number): void {
  if (cjk <= 0 && other <= 0) return
  const s = ensure(modelId)
  const now = Date.now()
  if (s.genStart === null) s.genStart = now
  const coef = coefOf(s)
  const tokens = cjk / coef.cjk + other / coef.other
  s.deltaSamples.push({ ts: now, tokens })
  s.genCjk += cjk
  s.genOther += other
  s.genEst += cjk / COEF_CJK + other / COEF_OTHER

  const second = Math.floor(now / 1000)
  if (second !== s.deltaSecond) {
    const shift = Math.min(BUCKETS, Math.max(0, second - s.deltaSecond))
    s.deltaBuckets = [...s.deltaBuckets.slice(shift), ...new Array<number>(shift).fill(0)]
    s.deltaSecond = second
  }
  const idx = BUCKETS - 1
  s.deltaBuckets[idx] = (s.deltaBuckets[idx] ?? 0) + tokens
}

function realtimeOf(s: ModelState, now: number): number | null {
  if (s.genStart === null) return null
  while (s.deltaSamples.length && (s.deltaSamples[0] as { ts: number }).ts < now - DELTA_WINDOW_MS) {
    s.deltaSamples.shift()
  }
  const sum = s.deltaSamples.reduce((a, b) => a + b.tokens, 0)
  const span = Math.min(DELTA_WINDOW_MS, Math.max(500, now - s.genStart)) / 1000
  return sum / span
}

function blankToday(): TodayTotals {
  return { requests: 0, errors: 0, input: 0, uncachedInput: 0, output: 0, cacheRead: 0, cacheInput: 0, cacheInputReported: 0, cacheReadReported: 0, cost: 0 }
}

function ensure(modelId: string): ModelState {
  const found = state.get(modelId)
  if (found) return found
  const created: ModelState = {
    buckets: new Array<number>(BUCKETS).fill(0),
    reqBuckets: new Array<number>(BUCKETS).fill(0),
    bucketSecond: Math.floor(Date.now() / 1000),
    today: blankToday(),
    lastError: null,
    lastErrorAt: null,
    lastTtftMs: null,
    lastTps: null,
    lastTpsAt: null,
    ttftSamples: [],
    probing: false,
    probeFails: 0,
    lastProbeAt: null,
    lastProbeOk: null,
    deltaSamples: [],
    deltaBuckets: new Array<number>(BUCKETS).fill(0),
    deltaSecond: Math.floor(Date.now() / 1000),
    genStart: null,
    genCjk: 0,
    genOther: 0,
    genEst: 0,
    calibObs: 0,
    calibEst: 0
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
    s.reqBuckets.fill(0)
  } else {
    s.buckets = [...s.buckets.slice(shift), ...new Array<number>(shift).fill(0)]
    s.reqBuckets = [...s.reqBuckets.slice(shift), ...new Array<number>(shift).fill(0)]
  }
  s.bucketSecond = sec
}

export function init(): void {
  const now = Date.now()
  const dayStart = new Date()
  dayStart.setHours(0, 0, 0, 0)
  cfg.mutate((c) => {
    for (const m of c.models) {
      const s = ensure(m.id)
      const t = repo.dayTotals(db.get(), m.id, dayKey(now))
      s.today = {
        requests: t.requests,
        errors: t.errors,
        input: t.input,
        uncachedInput: t.uncached,
        output: t.output,
        cacheRead: t.cache_read,
        cacheInput: t.cache_input,
        cacheInputReported: t.cache_input_reported,
        cacheReadReported: t.cache_read_reported,
        cost: t.cost
      }
      // 今天的 TTFT 样本从明细回灌，重启后分位数不空；replay 不再补，避免最近窗口被算两遍
      s.ttftSamples = repo.ttftSamplesSince(db.get(), m.id, dayStart.getTime())
      rollBuckets(s, now)
    }
  })
}

/**
 * 回放最近 60 秒，让重启后曲线不空。
 * 注意每个事件要按「自己的时间」落到对应秒桶里——按到达顺序堆到末尾会堆出一个假尖峰。
 */
export function replay(events: RequestEvent[], now = Date.now()): void {
  for (const ev of events) {
    // 失败的请求也要计入请求曲线，只是 token 为 0
    if (ev.ts > now) continue
    // 输出 token 按完成秒；请求量按「请求开始秒」，与速率的打点口径对齐
    const ageTokens = Math.floor((now - ev.ts) / 1000)
    const ageReq = Math.floor((now - (ev.ts - Math.max(0, ev.durationMs))) / 1000)
    if (ageTokens >= BUCKETS && ageReq >= BUCKETS) continue
    const s = ensure(ev.modelId)
    s.bucketSecond = Math.floor(now / 1000)
    if (ageTokens >= 0 && ageTokens < BUCKETS) {
      const idxTokens = BUCKETS - 1 - ageTokens
      s.buckets[idxTokens] = (s.buckets[idxTokens] ?? 0) + ev.outputTokens
    }
    if (ageReq >= 0 && ageReq < BUCKETS) {
      const idxReq = BUCKETS - 1 - ageReq
      s.reqBuckets[idxReq] = (s.reqBuckets[idxReq] ?? 0) + 1
    }
    if (ev.ttftMs !== null) s.lastTtftMs = ev.ttftMs
  }
}

export function record(ev: RequestEvent): void {
  const s = ensure(ev.modelId)
  rollBuckets(s, ev.ts)
  // 请求量按「请求开始秒」打点：速率增量在流式期间逐秒到达，按完成秒打点会整体迟到一段请求耗时
  const idx = BUCKETS - 1 - Math.min(BUCKETS - 1, Math.floor(Math.max(0, ev.durationMs) / 1000))
  s.reqBuckets[idx] = (s.reqBuckets[idx] ?? 0) + 1
  if (ev.ok) {
    s.today.requests += 1
    s.today.input += ev.inputTokens
    s.today.uncachedInput += ev.uncachedInputTokens
    s.today.output += ev.outputTokens
    s.today.cacheRead += ev.cacheReadTokens
    s.today.cacheInput += ev.cacheInputTokens
    if (ev.cacheInputReported) s.today.cacheInputReported += 1
    if (ev.cacheReadReported) s.today.cacheReadReported += 1
    s.today.cost += ev.cost
    if (ev.ttftMs !== null) {
      s.lastTtftMs = ev.ttftMs
      if (ev.source === 'proxy') pushTtftSample(s, ev.ttftMs)
    }
    // 最近一次请求的生成速率（tok/s），给胶囊与表格的「上一条」口径用
    const gen = tps(ev.outputTokens, ev.durationMs, ev.ttftMs)
    if (gen !== null) {
      s.lastTps = gen
      s.lastTpsAt = ev.ts
    }
    s.buckets[idx] = (s.buckets[idx] ?? 0) + ev.outputTokens
    // 用真实 usage 校正本模型的估算系数；只有有真实输出与字符时才采信
    if (ev.outputTokens > 0 && s.genEst > 0) {
      s.calibObs += ev.outputTokens
      s.calibEst += s.genEst
    }
    s.genCjk = 0
    s.genOther = 0
    s.genEst = 0
  } else {
    s.today.requests += 1
    s.today.errors += 1
    s.lastError = describe(ev)
    s.lastErrorAt = ev.ts
  }
  recent.unshift(ev)
  if (recent.length > RECENT_MAX) recent.length = RECENT_MAX
}

function pushTtftSample(s: ModelState, ms: number): void {
  s.ttftSamples.push(ms)
  if (s.ttftSamples.length > TTFT_SAMPLES_MAX) s.ttftSamples.shift()
}

/** 最近邻法分位数，无样本返回 null */
function ttftPct(samples: number[], p: number): number | null {
  if (samples.length === 0) return null
  const sorted = [...samples].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return Math.round(sorted[Math.max(0, idx)] ?? sorted[sorted.length - 1] ?? 0)
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

/** 自动探活结果：成功清零，失败累计 */
export function markProbe(modelId: string, ok: boolean): void {
  const s = ensure(modelId)
  s.lastProbeAt = Date.now()
  s.lastProbeOk = ok
  s.probeFails = ok ? 0 : s.probeFails + 1
}

export function probeFailsOf(modelId: string): number {
  return state.get(modelId)?.probeFails ?? 0
}

export function recentFor(modelId: string, limit = 20): RequestEvent[] {
  try {
    return repo.recentFor(db.get(), modelId, limit)
  } catch {
    return recent.filter((e) => e.modelId === modelId).slice(0, limit)
  }
}

export function tpsOf(s: ModelState): number {
  const tail = s.buckets.slice(-TPS_WINDOW)
  return tail.reduce((a, b) => a + b, 0) / TPS_WINDOW
}

export function snapshot(
  proxyRunning: boolean,
  proxyError: string | null,
  baseUrl: string,
  now = Date.now()
): LiveSnapshot {
  const settings = cfg.get().settings
  const providers = new Map(cfg.listProviders().map((p) => [p.id, p]))

  const models: ModelLive[] = []
  const totals: SnapshotTotals = {
    tps: 0,
    hitRate: null,
    todayCost: 0,
    requests: 0,
    errors: 0,
    currency: 'CNY',
    buckets: new Array<number>(BUCKETS).fill(0),
    reqBuckets: new Array<number>(BUCKETS).fill(0)
  }

  for (const m of cfg.listModels()) {
    const s = ensure(m.id)
    rollBuckets(s, now)
    const second = Math.floor(now / 1000)
    if (second !== s.deltaSecond) {
      const shift = Math.min(BUCKETS, Math.max(0, second - s.deltaSecond))
      s.deltaBuckets = [...s.deltaBuckets.slice(shift), ...new Array<number>(shift).fill(0)]
      s.deltaSecond = second
    }
    const provider = providers.get(m.providerId)
    const tps = tpsOf(s)
    const realtimeTps = realtimeOf(s, now)
    // 渠道具备缓存读计数（有过上报或曾命中过）才显示数值；否则显示 — 而非误导性的 0.00%
    const hitRate = (s.today.cacheReadReported > 0 || s.today.cacheRead > 0) && s.today.input > 0 ? s.today.cacheRead / s.today.input : null
    models.push({
      modelId: m.id,
      alias: m.alias,
      providerName: provider?.name ?? '（供应商已删）',
      baseUrl: provider?.baseUrl ?? '',
      upstreamModel: m.upstreamModel,
      format: provider?.format ?? 'openai',
      currency: m.currency,
      watch: m.watch,
      showRate: m.showRate,
      buckets: [...s.buckets],
      deltaBuckets: [...s.deltaBuckets],
      tps,
      realtimeTps,
      hitRate,
      today: { ...s.today },
      lastError: s.lastError,
      lastErrorAt: s.lastErrorAt,
      lastTtftMs: s.lastTtftMs,
      lastTps: s.lastTps,
      lastTpsAt: s.lastTpsAt,
      ttftP50: ttftPct(s.ttftSamples, 50),
      ttftP95: ttftPct(s.ttftSamples, 95),
      ttftP99: ttftPct(s.ttftSamples, 99),
      inflight: inflight.get(m.id) ?? 0,
      active:
        (inflight.get(m.id) ?? 0) > 0 || (visibleUntil.get(m.id) ?? 0) > now,
      probing: s.probing,
      autoProbe: m.autoProbe === true,
      lastProbeAt: s.lastProbeAt,
      lastProbeOk: s.lastProbeOk,
      probeFails: s.probeFails,
    })
    totals.tps += tps
    for (let i = 0; i < BUCKETS; i++) {
      totals.buckets[i] = (totals.buckets[i] ?? 0) + (s.buckets[i] ?? 0)
      totals.reqBuckets[i] = (totals.reqBuckets[i] ?? 0) + (s.reqBuckets[i] ?? 0)
    }
    totals.todayCost += s.today.cost
    totals.requests += s.today.requests
    totals.errors += s.today.errors
    totals.currency = m.currency
  }

  const inputTotal = models.reduce((a, x) => a + x.today.input, 0)
  const cacheTotal = models.reduce((a, x) => a + x.today.cacheRead, 0)
  const readKnown = models.some((x) => x.today.cacheReadReported > 0 || x.today.cacheRead > 0)
  totals.hitRate = readKnown && inputTotal > 0 ? cacheTotal / inputTotal : null

  return {
    ts: now,
    proxyRunning,
    proxyError,
    baseUrl,
    models: models.filter((m) => cfg.modelById(m.modelId)?.enabled !== false),
    totals,
    overlayModelId: settings.overlay.modelId,
    overlay: settings.overlay
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
