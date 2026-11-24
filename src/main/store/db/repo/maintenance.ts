import type { Db } from '../driver'
import { dayKey } from '../../../../shared/date'

export function prune(
  db: Db,
  now: number,
  detailDays: number,
  minuteDays: number
): { requests: number; minutes: number } {
  const detailCut = now - detailDays * 86_400_000
  const minuteCut = now - minuteDays * 86_400_000
  const before = db.get<{ c: number }>('select count(*) as c from requests')?.c ?? 0
  db.run('delete from requests where ts < ?', detailCut)
  db.run('delete from app_logs where ts < ?', detailCut)
  db.run('delete from rollup_token_minute where minute < ?', minuteCut)
  db.run('delete from rollup_token_day where day < ?', dayKey(minuteCut))
  const after = db.get<{ c: number }>('select count(*) as c from requests')?.c ?? 0
  db.run('delete from rollup_minute where minute < ?', minuteCut)
  db.exec('pragma incremental_vacuum')
  return { requests: Math.max(0, before - after), minutes: 0 }
}

export function backupTo(db: Db, file: string): void {
  db.exec(`vacuum into '${file.replace(/'/g, "''")}'`)
}

/** 备注改名后回写历史：明细按 token_id 改名，两张 token 聚合从明细整表重建（聚合键无 token_id，整表重建才与明细严格一致），同一事务。 */
export function renameTokenRemark(db: Db, tokenId: string, from: string, to: string): void {
  db.tx(() => {
    db.run('update requests set token_remark = ? where token_id = ?', to, tokenId)
    rebuildTokenRollups(db)
  })
}

/** 从 requests 明细全量重建两张 token 聚合（幂等；回填与改名共用）。 */
export function rebuildTokenRollups(db: Db): void {
  db.run('delete from rollup_token_minute')
  db.run('delete from rollup_token_day')
  db.run(`
    insert into rollup_token_minute (minute, token_remark, source, requests, errors, input, uncached, output, cache_read, cache_input, cache_input_reported, cache_read_reported, cost)
    select (ts / 60000) * 60000, coalesce(token_remark, '默认'), source,
           count(*), sum(case when ok = 0 then 1 else 0 end),
           ifnull(sum(input_tokens),0), ifnull(sum(uncached_input_tokens),0), ifnull(sum(output_tokens),0),
           ifnull(sum(cache_read_tokens),0), ifnull(sum(cache_input_tokens),0), ifnull(sum(cache_input_reported),0), ifnull(sum(cache_read_reported),0),
           ifnull(sum(cost),0)
    from requests group by (ts / 60000) * 60000, source, coalesce(token_remark, '默认')
  `)
  db.run(`
    insert into rollup_token_day (day, token_remark, source, requests, errors, input, uncached, output, cache_read, cache_input, cache_input_reported, cache_read_reported, cost)
    select day, coalesce(token_remark, '默认'), source,
           count(*), sum(case when ok = 0 then 1 else 0 end),
           ifnull(sum(input_tokens),0), ifnull(sum(uncached_input_tokens),0), ifnull(sum(output_tokens),0),
           ifnull(sum(cache_read_tokens),0), ifnull(sum(cache_input_tokens),0), ifnull(sum(cache_input_reported),0), ifnull(sum(cache_read_reported),0),
           ifnull(sum(cost),0)
    from requests group by day, source, coalesce(token_remark, '默认')
  `)
}

