import type { AppLog, AppLogLevel, LogPage, LogQuery, RequestLog } from '../../../../shared/types'
import { toEvent, type RecentRow } from './rows'
import type { Db, SqlValue } from '../driver'

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
            input_tokens, uncached_input_tokens, output_tokens, cache_read_tokens, cache_input_tokens, cache_input_reported, cache_read_reported,
            cost, currency, model_id, alias, provider_id, note, provider_name, upstream_model
     from requests where ${clause} order by ts desc limit ? offset ?`,
    ...all,
    q.pageSize,
    (q.page - 1) * q.pageSize
  )
  return {
    total,
    rows: rows.map((r) => ({ ...toEvent(r), providerName: r.provider_name, upstreamModel: r.upstream_model }))
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

