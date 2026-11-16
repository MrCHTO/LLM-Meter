/** 副本上完整跑 renameTokenRemark(默认→Zcode)，含聚合三步与守卫观察。 */
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { cpSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'

const src = process.env.APPDATA + '/llm-meter/data/llm-meter.db'
const root = mkdtempSync(join(tmpdir(), 'renametest2-'))
const dest = join(root, 'copy.db')
cpSync(src, dest)

const db = new DatabaseSync(dest)
const TOKEN_ID = '266bea53-d985-4787-a121-d37a908fec82'
const from = '默认', to = 'Zcode'

const dump = (tag) => {
  console.log(tag, '明细:', JSON.stringify(db.prepare('select token_remark, count(*) n from requests group by token_remark').all()))
  console.log(tag, 'day聚合:', JSON.stringify(db.prepare('select token_remark, count(*) n, ifnull(sum(requests),0) r from rollup_token_day group by token_remark').all()))
}

dump('改前')
db.exec('begin')
try {
  db.prepare('update requests set token_remark = ? where token_id = ?').run(to, TOKEN_ID)
  console.log('明细 update 影响:', db.prepare('select changes() c').get().c)
  for (const table of ['rollup_token_minute', 'rollup_token_day']) {
    const key = table === 'rollup_token_minute' ? 'minute' : 'day'
    db.prepare(`update or ignore ${table} set token_remark = ? where token_remark = ?`).run(to, from)
    console.log(table, 'step1 影响:', db.prepare('select changes() c').get().c, '剩余 from 行:', db.prepare(`select count(*) c from ${table} where token_remark = ?`).get(from).c)
    // step2 守卫版合并
    db.prepare(`update ${table} set
       requests = requests + (select r.requests from ${table} r where r.${key} = ${table}.${key} and r.token_remark = ? and r.source = ${table}.source),
       errors = errors + (select r.errors from ${table} r where r.${key} = ${table}.${key} and r.token_remark = ? and r.source = ${table}.source),
       input = input + (select r.input from ${table} r where r.${key} = ${table}.${key} and r.token_remark = ? and r.source = ${table}.source),
       uncached = uncached + (select r.uncached from ${table} r where r.${key} = ${table}.${key} and r.token_remark = ? and r.source = ${table}.source),
       output = output + (select r.output from ${table} r where r.${key} = ${table}.${key} and r.token_remark = ? and r.source = ${table}.source),
       cache_read = cache_read + (select r.cache_read from ${table} r where r.${key} = ${table}.${key} and r.token_remark = ? and r.source = ${table}.source),
       cache_input = cache_input + (select r.cache_input from ${table} r where r.${key} = ${table}.${key} and r.token_remark = ? and r.source = ${table}.source),
       cache_input_reported = cache_input_reported + (select r.cache_input_reported from ${table} r where r.${key} = ${table}.${key} and r.token_remark = ? and r.source = ${table}.source),
       cost = cost + (select r.cost from ${table} r where r.${key} = ${table}.${key} and r.token_remark = ? and r.source = ${table}.source)
     where token_remark = ? and exists (
       select 1 from ${table} r where r.${key} = ${table}.${key} and r.token_remark = ? and r.source = ${table}.source
     )`).run(from, from, from, from, from, from, from, from, from, to, from)
    console.log(table, 'step2 影响:', db.prepare('select changes() c').get().c)
    db.prepare(`delete from ${table} where token_remark = ?`).run(from)
  }
  db.exec('commit')
  console.log('事务提交成功')
} catch (err) {
  db.exec('rollback')
  console.log('事务失败:', String(err))
}
dump('改后')
db.close()
rmSync(root, { recursive: true, force: true })
