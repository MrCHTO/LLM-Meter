import type { AppLog, AppLogLevel, LogPage, LogQuery, RequestEvent, RequestLog } from '../../../shared/types'
import type { Db, SqlValue } from './driver'

const MINUTE = 60_000
const HOUR = 3_600_000

export interface Enrich {
  day: string
  providerName: string
  baseUrl: string
  upstreamModel: string
  /** 记录当时的单价（每百万 token、人民币），供成本复核 */
  priceIn?: number
  priceOut?: number
  priceCacheRead?: number
  priceCacheWrite?: number
  /** 命中的接入 token（探针为空） */
  tokenId?: string | null
  tokenRemark?: string | null
}

/** 一次请求：明细 + 两张聚合表，同一事务。 */
export function recordRequest(db: Db, ev: RequestEvent, extra: Enrich): void {
  db.tx(() => {
    db.run(
      `insert into requests (
        id, ts, day, source, status, ok, error_kind, stream, ttft_ms, duration_ms,
        input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
        cost, currency, model_id, alias, provider_id, provider_name, base_url, upstream_model, note,
        price_in, price_out, price_cache_read, price_cache_write, token_id, token_remark
      ) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
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
      ev.outputTokens,
      ev.cacheReadTokens,
      ev.cacheWriteTokens,
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
      extra.priceCacheWrite ?? 0,
      extra.tokenId ?? null,
      extra.tokenRemark ?? null
    )

    const minute = Math.floor(ev.ts / MINUTE) * MINUTE
    const errors = ev.ok ? 0 : 1
    bump(db, 'rollup_minute', minute, ev, errors)
    bump(db, 'rollup_day', extra.day, ev, errors)
    if (extra.tokenRemark) bumpToken(db, 'rollup_token_minute', minute, ev, errors, extra.tokenRemark)
    if (extra.tokenRemark) bumpToken(db, 'rollup_token_day', extra.day, ev, errors, extra.tokenRemark)
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
    `insert into ${table} (${keyCol}, token_remark, source, requests, errors, input, output, cache_read, cache_write, cost)
     values (?,?,?,?,1,?,?,?,?,?)
     on conflict (${keyCol}, token_remark, source) do update set
       requests = requests + 1,
       errors = errors + excluded.errors,
       input = input + excluded.input,
       output = output + excluded.output,
       cache_read = cache_read + excluded.cache_read,
       cache_write = cache_write + excluded.cache_write,
       cost = cost + excluded.cost`,
    bucket,
    remark,
    ev.source,
    errors,
    ev.inputTokens,
    ev.outputTokens,
    ev.cacheReadTokens,
    ev.cacheWriteTokens,
    ev.cost
  )
}

function bump(db: Db, table: 'rollup_minute' | 'rollup_day', bucket: number | string, ev: RequestEvent, errors: number): void {
  const keyCol = table === 'rollup_minute' ? 'minute' : 'day'
  db.run(
    `insert into ${table} (${keyCol}, model_id, provider_id, source, requests, errors, input, output, cache_read, cache_write, cost)
     values (?,?,?,?,1,?,?,?,?,?,?)
     on conflict (${keyCol}, model_id, source) do update set
       requests = requests + 1,
       errors = errors + excluded.errors,
       input = input + excluded.input,
       output = output + excluded.output,
       cache_read = cache_read + excluded.cache_read,
       cache_write = cache_write + excluded.cache_write,
       cost = cost + excluded.cost`,
    bucket,
    ev.modelId,
    ev.providerId,
    ev.source,
    errors,
    ev.inputTokens,
    ev.outputTokens,
    ev.cacheReadTokens,
    ev.cacheWriteTokens,
    ev.cost
  )
}

export interface TotalsRow {
  requests: number
  errors: number
  input: number
  output: number
  cache_read: number
  cache_write: number
  cost: number
}

export function dayTotals(db: Db, modelId: string, day: string): TotalsRow {
  const row = db.get<TotalsRow>(
    `select coalesce(sum(requests),0) requests, coalesce(sum(errors),0) errors,
            coalesce(sum(input),0) input, coalesce(sum(output),0) output,
            coalesce(sum(cache_read),0) cache_read, coalesce(sum(cache_write),0) cache_write,
            coalesce(sum(cost),0) cost
     from rollup_day where day = ? and model_id = ? and source = 'proxy'`,
    day,
    modelId
  )
  return row ?? { requests: 0, errors: 0, input: 0, output: 0, cache_read: 0, cache_write: 0, cost: 0 }
}

/** 今天的 TTFT 样本，供重启后回灌分位数 */
export function ttftSamplesSince(db: Db, modelId: string, sinceTs: number): number[] {
  return db
    .all<{ v: number }>(
      "select ttft_ms as v from requests where model_id = ? and ok = 1 and source = 'proxy' and ttft_ms is not null and ts >= ? order by ts",
      modelId,
      sinceTs
    )
    .map((r) => Number(r.v))
}

export interface RecentRow {
  id: string
  ts: number
  source: string
  status: number
  ok: number
  error_kind: string | null
  stream: number
  ttft_ms: number | null
  duration_ms: number
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
  cost: number
  currency: string
  model_id: string
  alias: string
  provider_id: string
  note: string | null
  token_id?: string | null
  token_remark?: string | null
}

export function recentFor(db: Db, modelId: string, limit: number): RequestEvent[] {
  const rows = db.all<RecentRow>(
    `select id, ts, source, status, ok, error_kind, stream, ttft_ms, duration_ms,
            input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
            cost, currency, model_id, alias, provider_id, note
     from requests where model_id = ? order by ts desc limit ?`,
    modelId,
    limit
  )
  return rows.map((r) => ({
    id: r.id,
    ts: r.ts,
    source: r.source === 'probe' ? 'probe' : 'proxy',
    modelId: r.model_id,
    alias: r.alias,
    providerId: r.provider_id,
    status: r.status,
    ok: r.ok === 1,
    errorKind: (r.error_kind as RequestEvent['errorKind']) ?? null,
    stream: r.stream === 1,
    ttftMs: r.ttft_ms,
    durationMs: r.duration_ms,
    inputTokens: r.input_tokens,
    outputTokens: r.output_tokens,
    cacheReadTokens: r.cache_read_tokens,
    cacheWriteTokens: r.cache_write_tokens,
    cost: r.cost,
    currency: r.currency,
    note: r.note ?? undefined
  }))
}

export function replaySince(db: Db, since: number): RequestEvent[] {
  return recentFor(db, '', 0).length === 0
    ? []
    : recentAfter(db, since)
}

function recentAfter(db: Db, since: number): RequestEvent[] {
  const rows = db.all<RecentRow>(
    `select id, ts, source, status, ok, error_kind, stream, ttft_ms, duration_ms,
            input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
            cost, currency, model_id, alias, provider_id, note
     from requests where ts >= ? and ok = 1 order by ts asc`,
    since
  )
  return rows.map((r) => ({
    id: r.id,
    ts: r.ts,
    source: r.source === 'probe' ? 'probe' : 'proxy',
    modelId: r.model_id,
    alias: r.alias,
    providerId: r.provider_id,
    status: r.status,
    ok: true,
    errorKind: null,
    stream: r.stream === 1,
    ttftMs: r.ttft_ms,
    durationMs: r.duration_ms,
    inputTokens: r.input_tokens,
    outputTokens: r.output_tokens,
    cacheReadTokens: r.cache_read_tokens,
    cacheWriteTokens: r.cache_write_tokens,
    cost: r.cost,
    currency: r.currency,
    note: r.note ?? undefined
  }))
}

/* ------------------------------- 日志页 ------------------------------- */

export function queryRequests(db: Db, q: LogQuery): LogPage<RequestLog> {
  const where = ['ts >= ?', 'ts <= ?']
  const all: SqlValue[] = [q.from, q.to]
  if (q.keyword && q.keyword.trim()) {
    const like = `%${q.keyword.trim()}%`
    where.push('(alias like ? or upstream_model like ? or provider_name like ? or note like ? or error_kind like ?)')
    all.push(like, like, like, like, like)
  }
  if (q.modelId) {
    where.push('model_id = ?')
    all.push(q.modelId)
  }
  if (q.source) {
    where.push('source = ?')
    all.push(q.source)
  }
  if (q.ok !== undefined) {
    where.push('ok = ?')
    all.push(q.ok ? 1 : 0)
  }
  const clause = where.join(' and ')
  const total = db.get<{ n: number }>(`select count(*) as n from requests where ${clause}`, ...all)?.n ?? 0
  const rows = db.all<RecentRow & { provider_name: string; upstream_model: string }>(
    `select id, ts, source, status, ok, error_kind, stream, ttft_ms, duration_ms,
            input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
            cost, currency, model_id, alias, provider_id, note, provider_name, upstream_model
     from requests where ${clause} order by ts desc limit ? offset ?`,
    ...all,
    q.pageSize,
    (q.page - 1) * q.pageSize
  )
  return {
    total,
    rows: rows.map((r) => ({
      id: r.id,
      ts: r.ts,
      source: r.source === 'probe' ? 'probe' : 'proxy',
      modelId: r.model_id,
      alias: r.alias,
      providerId: r.provider_id,
      providerName: r.provider_name,
      upstreamModel: r.upstream_model,
      status: r.status,
      ok: r.ok === 1,
      errorKind: (r.error_kind as RequestEvent['errorKind']) ?? null,
      stream: r.stream === 1,
      ttftMs: r.ttft_ms,
      durationMs: r.duration_ms,
      inputTokens: r.input_tokens,
      outputTokens: r.output_tokens,
      cacheReadTokens: r.cache_read_tokens,
      cacheWriteTokens: r.cache_write_tokens,
      cost: r.cost,
      currency: r.currency,
      note: r.note ?? undefined
    }))
  }
}

export function queryAppLogs(db: Db, q: LogQuery): LogPage<AppLog> {
  const where = ['ts >= ?', 'ts <= ?']
  const args: SqlValue[] = [q.from, q.to]
  if (q.keyword && q.keyword.trim()) {
    const like = `%${q.keyword.trim()}%`
    where.push('(scope like ? or message like ?)')
    args.push(like, like)
  }
  if (q.level) {
    where.push('level = ?')
    args.push(q.level)
  }
  const clause = where.join(' and ')
  const total = db.get<{ n: number }>(`select count(*) as n from app_logs where ${clause}`, ...args)?.n ?? 0
  const rows = db.all<{ id: string; ts: number; level: string; scope: string; message: string }>(
    `select id, ts, level, scope, message from app_logs where ${clause} order by ts desc limit ? offset ?`,
    ...args,
    q.pageSize,
    (q.page - 1) * q.pageSize
  )
  return { total, rows: rows.map((r) => ({ ...r, level: r.level as AppLogLevel })) }
}

export function insertAppLog(db: Db, id: string, ts: number, level: string, scope: string, message: string): void {
  db.run('insert into app_logs (id, ts, level, scope, message) values (?, ?, ?, ?, ?)', id, ts, level, scope, message)
}

/* ------------------------------- 分析查询 ------------------------------- */

export type Metric =
  | 'requests'
  | 'errors'
  | 'input'
  | 'output'
  | 'total'
  | 'cache_read'
  | 'cache_write'
  | 'cost'
  | 'tps'
export type Granularity = 'minute' | 'hour' | 'day'
export type GroupBy = 'model' | 'provider' | 'token'
export type SourceFilter = 'all' | 'proxy' | 'probe'

const METRIC_COL: Record<Exclude<Metric, 'tps' | 'total'>, string> = {
  requests: 'requests',
  errors: 'errors',
  input: 'input',
  output: 'output',
  cache_read: 'cache_read',
  cache_write: 'cache_write',
  cost: 'cost'
}

export interface SeriesPointSet {
  buckets: number[]
  series: { key: string; points: number[] }[]
}

export function series(
  db: Db,
  opts: { from: number; to: number; granularity: Granularity; metric: Metric; groupBy: GroupBy; source: SourceFilter }
): SeriesPointSet {
  const { from, to, granularity, metric, groupBy, source } = opts
  const tokenGroup = groupBy === 'token'
  const keyCol = groupBy === 'model' ? 'model_id' : groupBy === 'provider' ? 'provider_id' : 'token_remark'
  const table = tokenGroup
    ? granularity === 'day'
      ? 'rollup_token_day'
      : 'rollup_token_minute'
    : granularity === 'day'
      ? 'rollup_day'
      : 'rollup_minute'
  const bucketExpr =
    granularity === 'day'
      ? 'day'
      : granularity === 'hour'
        ? `(minute / ${HOUR}) * ${HOUR}`
        : 'minute'
  const timeCol = granularity === 'day' ? 'day' : 'minute'
  const valueExpr =
    metric === 'tps'
      ? 'sum(output) * 1.0'
      : metric === 'total'
        ? 'sum(input + output)'
        : `sum(${METRIC_COL[metric]})`

  const params: SqlValue[] = []
  const where: string[] = []
  if (granularity === 'day') {
    where.push(`${timeCol} >= ? and ${timeCol} <= ?`)
    params.push(dayKeyOf(from), dayKeyOf(to))
  } else {
    where.push(`${timeCol} >= ? and ${timeCol} < ?`)
    params.push(from, to)
  }
  if (source !== 'all') {
    where.push('source = ?')
    params.push(source)
  }

  const rows = db.all<{ b: number | string; k: string; v: number }>(
    `select ${bucketExpr} as b, ${keyCol} as k, ${valueExpr} as v
     from ${table} where ${where.join(' and ')} group by b, k order by b`,
    ...params
  )

  const buckets: number[] = []
  const index = new Map<number, number>()
  const byKey = new Map<string, number[]>()
  const seconds = granularity === 'minute' ? 60 : granularity === 'hour' ? 3600 : 86400

  for (const row of rows) {
    const bucket = granularity === 'day' ? Date.parse(`${row.b}T00:00:00`) : Number(row.b)
    let at = index.get(bucket)
    if (at === undefined) {
      at = buckets.length
      index.set(bucket, at)
      buckets.push(bucket)
      for (const points of byKey.values()) points.push(0)
    }
    const value = metric === 'tps' ? (row.v ?? 0) / seconds : (row.v ?? 0)
    const points = byKey.get(row.k) ?? []
    while (points.length < buckets.length) points.push(0)
    points[at] = value
    byKey.set(row.k, points)
  }

  return { buckets, series: [...byKey.entries()].map(([key, points]) => ({ key, points })) }
}

export interface GroupTotals {
  key: string
  requests: number
  errors: number
  input: number
  output: number
  total: number
  cache_read: number
  cache_write: number
  cost: number
  ttft_p50: number | null
  ttft_p95: number | null
  ttft_p99: number | null
  tps: number | null
}

/** 每组内最近邻法分位数 */
function percentile(sortedAsc: number[], p: number): number | null {
  if (sortedAsc.length === 0) return null
  const idx = Math.min(sortedAsc.length - 1, Math.ceil((p / 100) * sortedAsc.length) - 1)
  return Math.round(sortedAsc[Math.max(0, idx)] ?? sortedAsc[sortedAsc.length - 1] ?? 0)
}

export function totals(
  db: Db,
  opts: { from: number; to: number; groupBy: GroupBy; source: SourceFilter }
): GroupTotals[] {
  const keyCol = opts.groupBy === 'model' ? 'model_id' : opts.groupBy === 'provider' ? 'provider_id' : "coalesce(token_remark, '(未记录)')"
  const params: SqlValue[] = [opts.from, opts.to]
  let where = 'ts >= ? and ts < ?'
  if (opts.source !== 'all') {
    where += ' and source = ?'
    params.push(opts.source)
  }
  const groups = db.all<GroupTotals>(
    `select ${keyCol} as key,
            sum(1) as requests,
            sum(case when ok = 0 then 1 else 0 end) as errors,
            coalesce(sum(input_tokens),0) as input,
            coalesce(sum(output_tokens),0) as output,
            coalesce(sum(input_tokens + output_tokens),0) as total,
            coalesce(sum(cache_read_tokens),0) as cache_read,
            coalesce(sum(cache_write_tokens),0) as cache_write,
            coalesce(sum(cost),0) as cost,
            case when sum(case when ok = 1 then duration_ms else 0 end) > 0
                 then sum(case when ok = 1 then output_tokens else 0 end) * 1000.0
                      / sum(case when ok = 1 then duration_ms else 0 end)
                 else null end as tps
     from requests where ${where} group by ${keyCol} order by cost desc`,
    ...params
  )

  // 分位数要逐样本，单独拉一列 ttft 再在内存里按组排序；只算代理流量，探针不进分位
  const ttftRows = db.all<{ k: string; v: number }>(
    `select ${keyCol} as k, ttft_ms as v from requests
     where ${where} and ok = 1 and source = 'proxy' and ttft_ms is not null`,
    ...params
  )
  const byKey = new Map<string, number[]>()
  for (const row of ttftRows) {
    const list = byKey.get(row.k)
    if (list) list.push(Number(row.v))
    else byKey.set(row.k, [Number(row.v)])
  }
  for (const g of groups) {
    const sorted = (byKey.get(g.key) ?? []).sort((a, b) => a - b)
    g.ttft_p50 = percentile(sorted, 50)
    g.ttft_p95 = percentile(sorted, 95)
    g.ttft_p99 = percentile(sorted, 99)
  }
  return groups
}

export function top(
  db: Db,
  opts: { from: number; to: number; by: 'cost' | 'requests' | 'output'; source: SourceFilter; limit: number }
): GroupTotals[] {
  return totals(db, { ...opts, groupBy: 'model' })
    .sort((a, b) => (b[opts.by] as number) - (a[opts.by] as number))
    .slice(0, opts.limit)
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
            input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost, currency,
            model_id, alias, provider_id, provider_name, base_url, upstream_model, note, token_id, token_remark
     from requests where ${where} order by ts asc`,
    ...params
  )
}

/** 近 N 天的按日合计（图表用的旧接口） */
export function daySeries(db: Db, days: number, modelId: string | null): { ts: number; out: number; req: number; err: number; cost: number }[] {
  const from = new Date()
  from.setDate(from.getDate() - (days - 1))
  from.setHours(0, 0, 0, 0)
  const rows = db.all<{ day: string; out: number; req: number; err: number; cost: number }>(
    `select day, coalesce(sum(output),0) out, coalesce(sum(requests),0) req,
            coalesce(sum(errors),0) err, coalesce(sum(cost),0) cost
     from rollup_day where day >= ? ${modelId ? 'and model_id = ?' : ''}
     group by day`,
    ...(modelId ? [dayKeyOf(from.getTime()), modelId] : [dayKeyOf(from.getTime())])
  )
  const byDay = new Map(rows.map((r) => [r.day, r]))
  const out: { ts: number; out: number; req: number; err: number; cost: number }[] = []
  for (let i = 0; i < days; i++) {
    const d = new Date(from)
    d.setDate(from.getDate() + i)
    const key = dayKeyOf(d.getTime())
    const row = byDay.get(key)
    out.push({ ts: d.getTime(), out: row?.out ?? 0, req: row?.req ?? 0, err: row?.err ?? 0, cost: row?.cost ?? 0 })
  }
  return out
}

export function prune(db: Db, now: number, detailDays: number, minuteDays: number): { requests: number; minutes: number } {  const detailCut = now - detailDays * 86_400_000
  const minuteCut = now - minuteDays * 86_400_000
  const before = db.get<{ c: number }>('select count(*) as c from requests')?.c ?? 0
  db.run('delete from requests where ts < ?', detailCut)
  db.run('delete from app_logs where ts < ?', detailCut)
  db.run('delete from rollup_token_minute where minute < ?', minuteCut)
  db.run('delete from rollup_token_day where day < ?', dayKeyOf(minuteCut))
  const after = db.get<{ c: number }>('select count(*) as c from requests')?.c ?? 0
  db.run('delete from rollup_minute where minute < ?', minuteCut)
  db.exec('pragma incremental_vacuum')
  return { requests: Math.max(0, before - after), minutes: 0 }
}

export function backupTo(db: Db, file: string): void {
  db.exec(`vacuum into '${file.replace(/'/g, "''")}'`)
}

function dayKeyOf(ts: number): string {
  const d = new Date(ts)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
