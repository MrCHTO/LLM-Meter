import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = mkdtempSync(join(tmpdir(), 'dbg-'))
console.log('tmp at', root, join(root, 'x'))

const db = new DatabaseSync(':memory:')
db.exec(`
create table rollup_token_minute (
  minute integer not null, token_remark text not null, source text not null,
  requests integer not null default 0, errors integer not null default 0,
  input integer not null default 0, uncached integer not null default 0,
  output integer not null default 0, cache_read integer not null default 0,
  cache_input integer not null default 0, cache_input_reported integer not null default 0,
  cost real not null default 0, primary key (minute, token_remark, source));
insert into rollup_token_minute values (1000, '旧名', 'proxy', 1, 0, 100, 20, 10, 80, 0, 0, 0.001);
insert into rollup_token_minute values (1000, '新名', 'proxy', 1, 0, 300, 60, 30, 240, 0, 0, 0.003);
`)
const from = '旧名', to = '新名'
db.exec(`update or ignore rollup_token_minute set token_remark = '${to}' where token_remark = '${from}'`)
console.log('after step1:', JSON.stringify(db.prepare('select token_remark, requests, input from rollup_token_minute').all()))
const sql = `
update rollup_token_minute set
  requests = requests + (select r.requests from rollup_token_minute r where r.minute = rollup_token_minute.minute and r.token_remark = '${from}' and r.source = rollup_token_minute.source),
  errors = errors + (select r.errors from rollup_token_minute r where r.minute = rollup_token_minute.minute and r.token_remark = '${from}' and r.source = rollup_token_minute.source),
  input = input + (select r.input from rollup_token_minute r where r.minute = rollup_token_minute.minute and r.token_remark = '${from}' and r.source = rollup_token_minute.source),
  uncached = uncached + (select r.uncached from rollup_token_minute r where r.minute = rollup_token_minute.minute and r.token_remark = '${from}' and r.source = rollup_token_minute.source),
  output = output + (select r.output from rollup_token_minute r where r.minute = rollup_token_minute.minute and r.token_remark = '${from}' and r.source = rollup_token_minute.source),
  cache_read = cache_read + (select r.cache_read from rollup_token_minute r where r.minute = rollup_token_minute.minute and r.token_remark = '${from}' and r.source = rollup_token_minute.source),
  cache_input = cache_input + (select r.cache_input from rollup_token_minute r where r.minute = rollup_token_minute.minute and r.token_remark = '${from}' and r.source = rollup_token_minute.source),
  cache_input_reported = cache_input_reported + (select r.cache_input_reported from rollup_token_minute r where r.minute = rollup_token_minute.minute and r.token_remark = '${from}' and r.source = rollup_token_minute.source),
  cost = cost + (select r.cost from rollup_token_minute r where r.minute = rollup_token_minute.minute and r.token_remark = '${from}' and r.source = rollup_token_minute.source)
where token_remark = '${to}' and exists (
  select 1 from rollup_token_minute r where r.minute = rollup_token_minute.minute and r.token_remark = '${from}' and r.source = rollup_token_minute.source
)`
db.exec(sql)
console.log('after step2:', JSON.stringify(db.prepare('select token_remark, requests, input from rollup_token_minute').all()))
db.exec(`delete from rollup_token_minute where token_remark = '${from}'`)
console.log('final:', JSON.stringify(db.prepare('select token_remark, requests, input, output, cost from rollup_token_minute').all()))
