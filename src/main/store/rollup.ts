import { readFileSync, readdirSync, renameSync, unlinkSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { writeFileSync } from 'node:fs'
import { dayKey, ensureDirs, rollupDir } from './paths'
import type { DayPoint, RequestEvent } from '../../shared/types'

const FILE_RE = /^\d{4}-\d{2}-\d{2}\.json$/
const MINUTE = 60_000

export interface Bucket {
  out: number
  req: number
  err: number
  cost: number
  input: number
  cacheRead: number
  cacheWrite: number
}

type ModelBuckets = Record<string, Bucket>
type DayDoc = Record<string, ModelBuckets>

let day = dayKey()
let doc: DayDoc = {}
let dirty = false
let timer: NodeJS.Timeout | null = null

function fileFor(d: string): string {
  return join(rollupDir(), `${d}.json`)
}

function bucket(ts: number, modelId: string): Bucket {
  const minute = String(Math.floor(ts / MINUTE) * MINUTE)
  const models = (doc[minute] ??= {})
  const b = (models[modelId] ??= {
    out: 0,
    req: 0,
    err: 0,
    cost: 0,
    input: 0,
    cacheRead: 0,
    cacheWrite: 0
  })
  return b
}

function load(d: string): DayDoc {
  if (!existsSync(fileFor(d))) return {}
  try {
    const parsed: unknown = JSON.parse(readFileSync(fileFor(d), 'utf8'))
    return parsed && typeof parsed === 'object' ? (parsed as DayDoc) : {}
  } catch {
    return {}
  }
}

export function init(): void {
  ensureDirs()
  day = dayKey()
  doc = load(day)
  if (timer) clearInterval(timer)
  timer = setInterval(flush, 15_000)
  timer.unref?.()
}

export function add(ev: RequestEvent): void {
  if (!ev.ok) {
    // 失败也计入错误桶，成本与 token 按实际（通常为 0）
    bucket(ev.ts, ev.modelId).err += 1
    bucket(ev.ts, ev.modelId).req += 1
    dirty = true
    return
  }
  const b = bucket(ev.ts, ev.modelId)
  b.req += 1
  b.out += ev.outputTokens
  b.input += ev.inputTokens
  b.cacheRead += ev.cacheReadTokens
  b.cacheWrite += ev.cacheWriteTokens
  b.cost += ev.cost
  dirty = true
}

export function flush(): void {
  if (!dirty) return
  dirty = false
  const today = dayKey()
  if (today !== day) {
    // 跨天：先把旧的一天落盘再切
    writeDoc(day, doc)
    day = today
    doc = load(day)
    return
  }
  writeDoc(day, doc)
}

function writeDoc(d: string, data: DayDoc): void {
  try {
    ensureDirs()
    const file = fileFor(d)
    const tmp = `${file}.tmp`
    writeFileSync(tmp, JSON.stringify(data), 'utf8')
    renameSync(tmp, file)
  } catch (err) {
    console.error('[rollup] write failed', err)
  }
}

/** 今日各模型累计，供启动时恢复内存态。 */
export function todayTotals(modelId: string): Required<Omit<Bucket, 'cacheWrite'>> & { cacheWrite: number } {
  const acc = { out: 0, req: 0, err: 0, cost: 0, input: 0, cacheRead: 0, cacheWrite: 0 }
  const startOfDay = new Date().setHours(0, 0, 0, 0)
  for (const [minute, models] of Object.entries(doc)) {
    if (Number(minute) < startOfDay) continue
    const b = models[modelId]
    if (!b) continue
    acc.out += b.out
    acc.req += b.req
    acc.err += b.err
    acc.cost += b.cost
    acc.input += b.input
    acc.cacheRead += b.cacheRead
    acc.cacheWrite += b.cacheWrite
  }
  return acc
}

/** 最近 N 天的按日聚合（只读已落盘文件，不含内存未刷部分）。 */
export function history(days: number, modelId: string | null): DayPoint[] {
  flush()
  const out: DayPoint[] = []
  const now = Date.now()
  for (let i = days - 1; i >= 0; i--) {
    const d = dayKey(now - i * 86400_000)
    const data = d === day ? doc : load(d)
    let point: DayPoint = { ts: new Date(`${d}T00:00:00`).getTime(), out: 0, req: 0, err: 0, cost: 0 }
    for (const models of Object.values(data)) {
      for (const [id, b] of Object.entries(models)) {
        if (modelId && id !== modelId) continue
        point = {
          ts: point.ts,
          out: point.out + b.out,
          req: point.req + b.req,
          err: point.err + b.err,
          cost: point.cost + b.cost
        }
      }
    }
    out.push(point)
  }
  return out
}

export function cleanup(retentionDays: number): void {
  const cutoff = dayKey(Date.now() - retentionDays * 86400_000)
  let names: string[]
  try {
    names = readdirSync(rollupDir())
  } catch {
    return
  }
  for (const name of names) {
    if (!FILE_RE.test(name)) continue
    if (name.slice(0, 10) >= cutoff) continue
    try {
      unlinkSync(join(rollupDir(), name))
    } catch {
      /* 忽略 */
    }
  }
}

export function dispose(): void {
  if (timer) clearInterval(timer)
  timer = null
  flush()
}
