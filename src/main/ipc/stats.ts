import type { StatsGroup, StatsQuery, StatsRow, StatsSeriesQuery } from '../../shared/types'
import * as cfg from '../store/config'
import * as db from '../store/db'
import * as repo from '../store/db/repo'
import { exportRange } from '../export/csv'
import { handle, wrap } from './shared'

/** 分组键转显示名：配置里删掉后用历史快照名兜底 */
function labelOf(group: StatsGroup, key: string): string {
  if (group === 'token') return key || '（未记录）'
  if (!key) return '（已删除）'
  const found = group === 'model' ? cfg.modelById(key)?.alias : cfg.providerById(key)?.name
  if (found) return found
  const row =
    group === 'model'
      ? db.get().get<{ v: string }>("select alias v from requests where model_id = ? and alias <> '' limit 1", key)
      : db
          .get()
          .get<{ v: string }>(
            "select provider_name v from requests where provider_id = ? and provider_name <> '' limit 1",
            key
          )
  return row?.v ?? key
}

function mapRow(group: StatsGroup) {
  return (r: repo.GroupTotals): StatsRow => ({
    key: r.key,
    label: labelOf(group, r.key),
    requests: r.requests,
    errors: r.errors,
    input: r.input,
    uncached: r.uncached,
    output: r.output,
    total: r.total,
    cacheRead: r.cache_read,
    cacheInput: r.cache_input,
    cacheInputReported: r.cache_input_reported,
    cacheReadReported: r.cache_read_reported,
    cost: r.cost,
    ttftP50: r.ttft_p50,
    ttftP95: r.ttft_p95,
    ttftP99: r.ttft_p99,
    tps: r.tps
  })
}

export function register(): void {
  handle(
    'statsSeries',
    wrap((q: StatsSeriesQuery) => {
      const out = repo.series(db.get(), q)
      return {
        buckets: out.buckets,
        series: out.series.map((s) => ({ key: s.key, label: labelOf(q.groupBy, s.key), points: s.points }))
      }
    })
  )

  handle(
    'statsTotals',
    wrap((q: StatsQuery & { groupBy: StatsGroup }) => repo.totals(db.get(), q).map(mapRow(q.groupBy)))
  )

  handle(
    'statsTop',
    wrap((q: StatsQuery & { by: 'cost' | 'requests' | 'output'; limit: number }) =>
      repo.top(db.get(), q).map(mapRow('model'))
    )
  )

  handle(
    'statsExport',
    wrap((q: StatsQuery) => exportRange(q))
  )
}
