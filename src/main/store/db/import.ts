import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import type { RequestEvent } from '../../../shared/types'
import * as cfg from '../config'
import { dayKey, eventsDir, rollupDir } from '../paths'
import type { Db } from './driver'

const BATCH = 500

interface LegacyBucket {
  out?: number
  req?: number
  err?: number
  cost?: number
  input?: number
  cacheRead?: number
  cacheInput?: number
}

/** 已经导过就别重复导 */
export function alreadyImported(db: Db): boolean {
  return Boolean(db.get('select value from schema_meta where key = ?', 'legacy_imported'))
}

/**
 * 一次性把旧 JSONL 明细与 rollup 聚合搬进库。
 * 逐批事务，失败就整体不标记，下次启动重试；成功后旧目录改名留底。
 */
export function importLegacy(db: Db, dataDir: string): { requests: number; minutes: number } {
  const evDir = eventsDir()
  const rDir = rollupDir()
  let requests = 0
  let minutes = 0

  if (existsSync(evDir)) {
    for (const name of readdirSync(evDir)) {
      if (!name.endsWith('.jsonl')) continue
      const lines = readFileSync(join(evDir, name), 'utf8').split('\n')
      let batch: RequestEvent[] = []
      const flush = (): void => {
        if (batch.length === 0) return
        db.tx(() => {
          for (const ev of batch) insertEvent(db, ev)
        })
        requests += batch.length
        batch = []
      }
      for (const line of lines) {
        if (!line.trim()) continue
        let ev: RequestEvent
        try {
          ev = JSON.parse(line) as RequestEvent
        } catch {
          continue
        }
        if (typeof ev.ts !== 'number' || !ev.id) continue
        batch.push(ev)
        if (batch.length >= BATCH) flush()
      }
      flush()
    }
  }

  if (existsSync(rDir)) {
    for (const name of readdirSync(rDir)) {
      if (!name.endsWith('.json')) continue
      let doc: Record<string, Record<string, LegacyBucket>>
      try {
        doc = JSON.parse(readFileSync(join(rDir, name), 'utf8')) as Record<string, Record<string, LegacyBucket>>
      } catch {
        continue
      }
      const rows: [number, Record<string, LegacyBucket>][] = Object.entries(doc).map(([minute, models]) => [
        Number(minute),
        models
      ])
      let i = 0
      while (i < rows.length) {
        const slice = rows.slice(i, i + BATCH)
        db.tx(() => {
          for (const [minute, models] of slice) {
            const day = dayKey(minute)
            for (const [modelId, b] of Object.entries(models)) {
              insertMinute(db, minute, modelId, b)
              bumpDay(db, day, modelId, b)
              minutes++
            }
          }
        })
        i += BATCH
      }
    }
  }

  // 旧目录改名留底，避免下次重复扫描
  const stamp = String(Date.now())
  const keep = join(dataDir, 'legacy-imported', stamp)
  mkdirSync(keep, { recursive: true })
  for (const dir of [evDir, rDir]) {
    if (!existsSync(dir)) continue
    try {
      renameSync(dir, join(keep, dir === evDir ? 'events' : 'rollup'))
    } catch {
      /* 改名失败不影响导入结果 */
    }
  }

  db.tx(() => {
    db.run('insert or replace into schema_meta (key, value) values (?, ?)', 'legacy_imported', stamp)
  })
  return { requests, minutes }
}

function insertEvent(db: Db, ev: RequestEvent): void {
  const providerId = ev.providerId || cfg.modelById(ev.modelId)?.providerId || ''
  const provider = providerId ? cfg.providerById(providerId) : undefined
  const model = cfg.modelById(ev.modelId)
  const day = dayKey(ev.ts)

  db.run(
    `insert or ignore into requests (
      id, ts, day, source, status, ok, error_kind, stream, ttft_ms, duration_ms,
      input_tokens, output_tokens, cache_read_tokens, cache_input_tokens,
      cost, currency, model_id, alias, provider_id, provider_name, base_url, upstream_model, note
    ) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ev.id,
    ev.ts,
    day,
    ev.source ?? 'proxy',
    ev.status ?? 0,
    ev.ok ? 1 : 0,
    ev.errorKind ?? null,
    ev.stream ? 1 : 0,
    ev.ttftMs ?? null,
    ev.durationMs ?? 0,
    ev.inputTokens ?? 0,
    ev.outputTokens ?? 0,
    ev.cacheReadTokens ?? 0,
    ev.cacheInputTokens ?? 0,
    ev.cost ?? 0,
    ev.currency ?? 'CNY',
    ev.modelId,
    ev.alias ?? '',
    providerId,
    provider?.name ?? '',
    provider?.baseUrl ?? '',
    model?.upstreamModel ?? '',
    ev.note ?? null
  )

  const minute = Math.floor(ev.ts / 60_000) * 60_000
  const bucket: LegacyBucket = {
    req: 1,
    err: ev.ok ? 0 : 1,
    out: ev.outputTokens ?? 0,
    input: ev.inputTokens ?? 0,
    cacheRead: ev.cacheReadTokens ?? 0,
    cacheInput: ev.cacheInputTokens ?? 0,
    cost: ev.cost ?? 0
  }
  insertMinute(db, minute, ev.modelId, bucket)
  bumpDay(db, day, ev.modelId, bucket, providerId, ev.source ?? 'proxy')
}

/** 日聚合累加；分钟桶导入时也走这里 */
function bumpDay(
  db: Db,
  day: string,
  modelId: string,
  bucket: LegacyBucket,
  providerId = '',
  source = 'proxy'
): void {
  const pid = providerId || cfg.modelById(modelId)?.providerId || ''
  db.run(
    `insert into rollup_day (day, model_id, provider_id, source, requests, errors, input, output, cache_read, cache_input, cost)
     values (?,?,?,?,?,?,?,?,?,?,?)
     on conflict (day, model_id, source) do update set
       requests = requests + excluded.requests,
       errors = errors + excluded.errors,
       input = input + excluded.input,
       output = output + excluded.output,
       cache_read = cache_read + excluded.cache_read,
       cache_input = cache_input + excluded.cache_input,
       cost = cost + excluded.cost`,
    day,
    modelId,
    pid,
    source,
    bucket.req ?? 0,
    bucket.err ?? 0,
    bucket.input ?? 0,
    bucket.out ?? 0,
    bucket.cacheRead ?? 0,
    bucket.cacheInput ?? 0,
    bucket.cost ?? 0
  )
}

function insertMinute(db: Db, minute: number, modelId: string, b: LegacyBucket): void {
  const providerId = cfg.modelById(modelId)?.providerId ?? ''
  db.run(
    `insert into rollup_minute (minute, model_id, provider_id, source, requests, errors, input, output, cache_read, cache_input, cost)
     values (?,?,?,?,?,?,?,?,?,?,?)
     on conflict (minute, model_id, source) do update set
       requests = requests + excluded.requests,
       errors = errors + excluded.errors,
       input = input + excluded.input,
       output = output + excluded.output,
       cache_read = cache_read + excluded.cache_read,
       cache_input = cache_input + excluded.cache_input,
       cost = cost + excluded.cost`,
    minute,
    modelId,
    providerId,
    'proxy',
    b.req ?? 0,
    b.err ?? 0,
    b.input ?? 0,
    b.out ?? 0,
    b.cacheRead ?? 0,
    b.cacheInput ?? 0,
    b.cost ?? 0
  )
}
