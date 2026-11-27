import type { Db, SqlValue } from '../driver'
import { dayKey } from '../../../../shared/date'

const HOUR = 3_600_000

/* ------------------------------- 分析查询 ------------------------------- */

export type Metric =
  'requests' | 'errors' | 'input' | 'uncached' | 'output' | 'total' | 'cache_read' | 'cache_input' | 'cost' | 'tps'
export type Granularity = 'minute' | 'hour' | 'day'
export type GroupBy = 'model' | 'provider' | 'token'
export type SourceFilter = 'all' | 'proxy' | 'probe'

const METRIC_COL: Record<Exclude<Metric, 'tps' | 'total'>, string> = {
  requests: 'requests',
  errors: 'errors',
  input: 'input',
  uncached: 'uncached',
  output: 'output',
  cache_read: 'cache_read',
  cache_input: 'cache_input',
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
  const bucketExpr = granularity === 'day' ? 'day' : granularity === 'hour' ? `(minute / ${HOUR}) * ${HOUR}` : 'minute'
  const timeCol = granularity === 'day' ? 'day' : 'minute'
  const valueExpr =
    metric === 'tps' ? 'sum(output) * 1.0' : metric === 'total' ? 'sum(input + output)' : `sum(${METRIC_COL[metric]})`

  const params: SqlValue[] = []
  const where: string[] = []
  if (granularity === 'day') {
    where.push(`${timeCol} >= ? and ${timeCol} <= ?`)
    params.push(dayKey(from), dayKey(to))
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
  const stepMs = seconds * 1000
  // 先把整个区间的桶占满，空时段也占时间轴，曲线不会从一段直接跳到另一段
  if (granularity === 'day') {
    // from/to 是毫秒时间戳，先换成日键再解析
    const end = Date.parse(`${dayKey(to)}T00:00:00`)
    let time = Date.parse(`${dayKey(from)}T00:00:00`)
    for (let guard = 0; guard < 5000 && time <= end; guard++) {
      index.set(time, buckets.length)
      buckets.push(time)
      time += 86400_000
    }
  } else {
    const start = Math.floor(from / stepMs) * stepMs
    for (let guard = 0; guard < 5000 && start + guard * stepMs < to; guard++) {
      const time = start + guard * stepMs
      index.set(time, buckets.length)
      buckets.push(time)
    }
  }

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

  for (const points of byKey.values()) {
    while (points.length < buckets.length) points.push(0)
  }
  return { buckets, series: [...byKey.entries()].map(([key, points]) => ({ key, points })) }
}

export interface GroupTotals {
  key: string
  requests: number
  errors: number
  input: number
  uncached: number
  output: number
  total: number
  cache_read: number
  cache_input: number
  cache_input_reported: number
  cache_read_reported: number
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
  const keyCol =
    opts.groupBy === 'model'
      ? 'model_id'
      : opts.groupBy === 'provider'
        ? 'provider_id'
        : "coalesce(token_remark, '(未记录)')"
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
            coalesce(sum(uncached_input_tokens),0) as uncached,
            coalesce(sum(output_tokens),0) as output,
            coalesce(sum(input_tokens + output_tokens),0) as total,
            coalesce(sum(cache_read_tokens),0) as cache_read,
            coalesce(sum(cache_input_tokens),0) as cache_input,
            coalesce(sum(cache_input_reported),0) as cache_input_reported,
            coalesce(sum(cache_read_reported),0) as cache_read_reported,
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

export interface TotalsRow {
  requests: number
  errors: number
  input: number
  uncached: number
  output: number
  cache_read: number
  cache_input: number
  cache_input_reported: number
  cache_read_reported: number
  cost: number
}

export function dayTotals(db: Db, modelId: string, day: string): TotalsRow {
  const row = db.get<TotalsRow>(
    `select coalesce(sum(requests),0) requests, coalesce(sum(errors),0) errors,
            coalesce(sum(input),0) input, coalesce(sum(uncached),0) uncached, coalesce(sum(output),0) output,
            coalesce(sum(cache_read),0) cache_read, coalesce(sum(cache_input),0) cache_input, coalesce(sum(cache_input_reported),0) cache_input_reported, coalesce(sum(cache_read_reported),0) cache_read_reported,
            coalesce(sum(cost),0) cost
     from rollup_day where day = ? and model_id = ? and source = 'proxy'`,
    day,
    modelId
  )
  return (
    row ?? {
      requests: 0,
      errors: 0,
      input: 0,
      uncached: 0,
      output: 0,
      cache_read: 0,
      cache_input: 0,
      cache_input_reported: 0,
      cache_read_reported: 0,
      cost: 0
    }
  )
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

export function daySeries(
  db: Db,
  days: number,
  modelId: string | null
): { ts: number; out: number; req: number; err: number; cost: number }[] {
  const from = new Date()
  from.setDate(from.getDate() - (days - 1))
  from.setHours(0, 0, 0, 0)
  const rows = db.all<{ day: string; out: number; req: number; err: number; cost: number }>(
    `select day, coalesce(sum(output),0) out, coalesce(sum(requests),0) req,
            coalesce(sum(errors),0) err, coalesce(sum(cost),0) cost
     from rollup_day where day >= ? ${modelId ? 'and model_id = ?' : ''}
     group by day`,
    ...(modelId ? [dayKey(from.getTime()), modelId] : [dayKey(from.getTime())])
  )
  const byDay = new Map(rows.map((r) => [r.day, r]))
  const out: { ts: number; out: number; req: number; err: number; cost: number }[] = []
  for (let i = 0; i < days; i++) {
    const d = new Date(from)
    d.setDate(from.getDate() + i)
    const key = dayKey(d.getTime())
    const row = byDay.get(key)
    out.push({ ts: d.getTime(), out: row?.out ?? 0, req: row?.req ?? 0, err: row?.err ?? 0, cost: row?.cost ?? 0 })
  }
  return out
}
