import type { RequestEvent } from '../../../../shared/types'
import type { Db, SqlValue } from '../driver'
import { toEvent, type RecentRow } from './rows'
import type { SourceFilter } from './stats'

const MINUTE = 60_000

export interface Enrich {
  day: string
  providerName: string
  baseUrl: string
  upstreamModel: string
  /** 记录当时的单价（每百万 token、人民币），供成本复核 */
  priceIn?: number
  priceOut?: number
  priceCacheRead?: number
  priceCacheInput?: number
  /** 命中的接入 token（探针为空） */
  tokenId?: string | null
  tokenRemark?: string | null
}

/** 一次请求：明细 + 两张聚合表，同一事务。 */
export function recordRequest(db: Db, ev: RequestEvent, extra: Enrich): void {
  // 探针没有命中的 token，统一归到「默认」，保证按 token 统计不留空洞
  const remark = extra.tokenRemark ?? '默认'
  db.tx(() => {
    db.run(
      `insert into requests (
        id, ts, day, source, status, ok, error_kind, stream, ttft_ms, duration_ms,
        input_tokens, uncached_input_tokens, output_tokens, cache_read_tokens, cache_input_tokens,
        cache_input_reported, cache_read_reported, cost, currency, model_id, alias, provider_id, provider_name, base_url, upstream_model, note,
        price_in, price_out, price_cache_read, price_cache_input, token_id, token_remark
      ) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ev.id,
      ev.ts,
      extra.day,
      ev.source,
      ev.status,
      ev.ok ? 1 : 0,
      ev.errorKind,
      ev.stream ? 1 : 0,
      ev.ttftMs,
      ev.durationMs,
      ev.inputTokens,
      ev.uncachedInputTokens,
      ev.outputTokens,
      ev.cacheReadTokens,
      ev.cacheInputTokens,
      ev.cacheInputReported ? 1 : 0,
      ev.cacheReadReported ? 1 : 0,
      ev.cost,
      ev.currency,
      ev.modelId,
      ev.alias,
      ev.providerId,
      extra.providerName,
      extra.baseUrl,
      extra.upstreamModel,
      ev.note ?? null,
      extra.priceIn ?? 0,
      extra.priceOut ?? 0,
      extra.priceCacheRead ?? 0,
      extra.priceCacheInput ?? 0,
      extra.tokenId ?? null,
      remark
    )

    const minute = Math.floor(ev.ts / MINUTE) * MINUTE
    const errors = ev.ok ? 0 : 1
    bump(db, 'rollup_minute', minute, ev, errors)
    bump(db, 'rollup_day', extra.day, ev, errors)
    bumpToken(db, 'rollup_token_minute', minute, ev, errors, remark)
    bumpToken(db, 'rollup_token_day', extra.day, ev, errors, remark)
  })
}

function bumpToken(
  db: Db,
  table: 'rollup_token_minute' | 'rollup_token_day',
  bucket: number | string,
  ev: RequestEvent,
  errors: number,
  remark: string
): void {
  const keyCol = table === 'rollup_token_minute' ? 'minute' : 'day'
  db.run(
    `insert into ${table} (${keyCol}, token_remark, source, requests, errors, input, uncached, output, cache_read, cache_input, cache_input_reported, cache_read_reported, cost)
     values (?,?,?,1,?,?,?,?,?,?,?,?,?)
     on conflict (${keyCol}, token_remark, source) do update set
       requests = requests + 1,
       errors = errors + excluded.errors,
       input = input + excluded.input,
       uncached = uncached + excluded.uncached,
       output = output + excluded.output,
       cache_read = cache_read + excluded.cache_read,
       cache_input = cache_input + excluded.cache_input,
       cache_input_reported = cache_input_reported + excluded.cache_input_reported,
       cache_read_reported = cache_read_reported + excluded.cache_read_reported,
       cost = cost + excluded.cost`,
    bucket,
    remark,
    ev.source,
    errors,
    ev.inputTokens,
    ev.uncachedInputTokens,
    ev.outputTokens,
    ev.cacheReadTokens,
    ev.cacheInputTokens,
    ev.cacheInputReported ? 1 : 0,
    ev.cacheReadReported ? 1 : 0,
    ev.cost
  )
}

function bump(
  db: Db,
  table: 'rollup_minute' | 'rollup_day',
  bucket: number | string,
  ev: RequestEvent,
  errors: number
): void {
  const keyCol = table === 'rollup_minute' ? 'minute' : 'day'
  db.run(
    `insert into ${table} (${keyCol}, model_id, provider_id, source, requests, errors, input, uncached, output, cache_read, cache_input, cache_input_reported, cache_read_reported, cost)
     values (?,?,?,?,1,?,?,?,?,?,?,?,?,?)
     on conflict (${keyCol}, model_id, source) do update set
       requests = requests + 1,
       errors = errors + excluded.errors,
       input = input + excluded.input,
       uncached = uncached + excluded.uncached,
       output = output + excluded.output,
       cache_read = cache_read + excluded.cache_read,
       cache_input = cache_input + excluded.cache_input,
       cache_input_reported = cache_input_reported + excluded.cache_input_reported,
       cache_read_reported = cache_read_reported + excluded.cache_read_reported,
       cost = cost + excluded.cost`,
    bucket,
    ev.modelId,
    ev.providerId,
    ev.source,
    errors,
    ev.inputTokens,
    ev.uncachedInputTokens,
    ev.outputTokens,
    ev.cacheReadTokens,
    ev.cacheInputTokens,
    ev.cacheInputReported ? 1 : 0,
    ev.cacheReadReported ? 1 : 0,
    ev.cost
  )
}

export function recentFor(db: Db, modelId: string, limit: number): RequestEvent[] {
  const rows = db.all<RecentRow>(
    `select id, ts, source, status, ok, error_kind, stream, ttft_ms, duration_ms,
            input_tokens, uncached_input_tokens, output_tokens, cache_read_tokens, cache_input_tokens, cache_input_reported, cache_read_reported,
            cost, currency, model_id, alias, provider_id, note
     from requests where model_id = ? order by ts desc limit ?`,
    modelId,
    limit
  )
  return rows.map(toEvent)
}

export function replaySince(db: Db, since: number): RequestEvent[] {
  return recentFor(db, '', 0).length === 0 ? [] : recentAfter(db, since)
}

function recentAfter(db: Db, since: number): RequestEvent[] {
  const rows = db.all<RecentRow>(
    `select id, ts, source, status, ok, error_kind, stream, ttft_ms, duration_ms,
            input_tokens, uncached_input_tokens, output_tokens, cache_read_tokens, cache_input_tokens, cache_input_reported, cache_read_reported,
            cost, currency, model_id, alias, provider_id, note
     from requests where ts >= ? and ok = 1 order by ts asc`,
    since
  )
  return rows.map(toEvent)
}

export interface ExportRow extends RecentRow {
  provider_name: string
  base_url: string
  upstream_model: string
  day: string
}

export function exportRange(db: Db, from: number, to: number, source: SourceFilter): ExportRow[] {
  const params: SqlValue[] = [from, to]
  let where = 'ts >= ? and ts < ?'
  if (source !== 'all') {
    where += ' and source = ?'
    params.push(source)
  }
  return db.all<ExportRow>(
    `select id, ts, day, source, status, ok, error_kind, stream, ttft_ms, duration_ms,
            input_tokens, uncached_input_tokens, output_tokens, cache_read_tokens, cache_input_tokens, cache_input_reported, cost, currency,
            model_id, alias, provider_id, provider_name, base_url, upstream_model, note, token_id, token_remark
     from requests where ${where} order by ts asc`,
    ...params
  )
}

/** 近 N 天的按日合计（图表用的旧接口） */
