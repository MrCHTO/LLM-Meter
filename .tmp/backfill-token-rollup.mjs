/** 一次性回填：0.13.4 前 bumpToken 种子行占位符错位，按明细重建两张 token 聚合表。 */
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { existsSync, statSync } from 'node:fs'

const dataDir = process.env.APPDATA + '/llm-meter/data'
const dbFile = join(dataDir, 'llm-meter.db')

const db = new DatabaseSync(dbFile)
db.exec('pragma busy_timeout=3000')

// 前置备份（不入仓，留 .bak）
const bak = join(dataDir, `llm-meter-backup-token-${Date.now()}.db`)
db.exec(`vacuum into '${bak.replace(/'/g, "''")}'`)
console.log('备份:', bak, `(${Math.round(statSync(bak).size / 1024)} KB)`)

const before = db.prepare(`
  select (select count(*) from requests) req_detail,
         (select ifnull(sum(requests),0) from rollup_token_minute) tm_req,
         (select ifnull(sum(requests),0) from rollup_token_day) td_req,
         (select ifnull(sum(errors),0) from rollup_token_minute) tm_err,
         (select ifnull(sum(errors),0) from rollup_token_day) td_err
`).get()
console.log('回填前: 明细请求', before.req_detail, '| tm', before.tm_req, '| td', before.td_req, '| tm失败', before.tm_err, '| td失败', before.td_err)

db.exec('begin')
try {
  db.exec('delete from rollup_token_minute')
  db.exec('delete from rollup_token_day')
  db.exec(`
    insert into rollup_token_minute (minute, token_remark, source, requests, errors, input, uncached, output, cache_read, cache_input, cache_input_reported, cost)
    select (ts / 60000) * 60000, token_remark, source,
           count(*), sum(case when ok = 0 then 1 else 0 end),
           ifnull(sum(input_tokens),0), ifnull(sum(uncached_input_tokens),0), ifnull(sum(output_tokens),0),
           ifnull(sum(cache_read_tokens),0), ifnull(sum(cache_input_tokens),0), ifnull(sum(cache_input_reported),0),
           ifnull(sum(cost),0)
    from requests group by (ts / 60000) * 60000, source, token_remark
  `)
  db.exec(`
    insert into rollup_token_day (day, token_remark, source, requests, errors, input, uncached, output, cache_read, cache_input, cache_input_reported, cost)
    select day, token_remark, source,
           count(*), sum(case when ok = 0 then 1 else 0 end),
           ifnull(sum(input_tokens),0), ifnull(sum(uncached_input_tokens),0), ifnull(sum(output_tokens),0),
           ifnull(sum(cache_read_tokens),0), ifnull(sum(cache_input_tokens),0), ifnull(sum(cache_input_reported),0),
           ifnull(sum(cost),0)
    from requests group by day, source, token_remark
  `)
  db.exec('commit')
} catch (err) {
  db.exec('rollback')
  throw err
}

const after = db.prepare(`
  select (select count(*) from requests) req_detail,
         (select ifnull(sum(requests),0) from rollup_token_minute) tm_req,
         (select ifnull(sum(requests),0) from rollup_token_day) td_req,
         (select ifnull(sum(errors),0) from rollup_token_minute) tm_err,
         (select ifnull(sum(errors),0) from rollup_token_day) td_err,
         (select ifnull(sum(input),0) from rollup_token_day) td_inp,
         (select ifnull(sum(cost),0) from rollup_token_day) td_cost
`).get()
console.log('回填后: 明细请求', after.req_detail, '| tm', after.tm_req, '| td', after.td_req, '| tm失败', after.tm_err, '| td失败', after.td_err)
console.log('对账: 明细输入', db.prepare('select ifnull(sum(input_tokens),0) v from requests').get().v, '| td聚合输入', after.td_inp)
console.log('对账: 明细成本', db.prepare('select ifnull(sum(cost),0) v from requests').get().v, '| td聚合成本', after.td_cost)

const ok =
  after.tm_req === after.req_detail &&
  after.td_req === after.req_detail &&
  after.tm_err === after.td_err
console.log(ok ? '回填一致 ✓' : '仍有漂移 ✗')
db.close()
