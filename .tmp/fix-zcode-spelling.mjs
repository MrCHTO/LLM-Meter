/** 一次性拼写修正：Zcode → ZCode（与配置一致），明细改名 + 聚合整表重建。 */
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { statSync } from 'node:fs'

const dataDir = process.env.APPDATA + '/llm-meter/data'
const db = new DatabaseSync(join(dataDir, 'llm-meter.db'))
db.exec('pragma busy_timeout=3000')

const bak = join(dataDir, `llm-meter-backup-spelling-${Date.now()}.db`)
db.exec(`vacuum into '${bak.replace(/'/g, "''")}'`)
console.log('备份:', bak, `(${Math.round(statSync(bak).size / 1024)} KB)`)

db.exec('begin')
try {
  db.prepare('update requests set token_remark = ? where token_remark = ?').run('ZCode', 'Zcode')
  console.log('明细改名影响:', db.prepare('select changes() c').get().c)
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

console.log('修正后明细:', JSON.stringify(db.prepare('select token_remark, count(*) n from requests group by token_remark').all()))
console.log('修正后日聚合:', JSON.stringify(db.prepare('select token_remark, count(*) n, ifnull(sum(requests),0) r from rollup_token_day group by token_remark').all()))
db.close()
