import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'

const dataDir = process.env.APPDATA + '/llm-meter/data'
const db = new DatabaseSync(join(dataDir, 'llm-meter.db'), { readOnly: true })

// 明细覆盖范围：有没有 requests 里的行已经不在（比如被 prune 清掉的），聚合能否无损重建
const reqMin = db.prepare('select min(ts) t, count(*) n from requests').get()
console.log('requests 行数/最早:', reqMin.n, new Date(reqMin.t).toISOString())

// 现有 token 聚合的漂移量：sum(requests) vs 明细条数，sum(errors) vs 明细失败数
const drift = db.prepare(`
  select
    (select count(*) from requests) as req_detail,
    (select ifnull(sum(requests),0) from rollup_token_minute) as req_tm,
    (select ifnull(sum(requests),0) from rollup_token_day) as req_td,
    (select count(*) from requests where ok = 0) as err_detail,
    (select ifnull(sum(errors),0) from rollup_token_minute) as err_tm,
    (select ifnull(sum(errors),0) from rollup_token_day) as err_td
`).get()
console.log('漂移: 明细请求', drift.req_detail, '| tm聚合', drift.req_tm, '| td聚合', drift.req_td)
console.log('漂移: 明细失败', drift.err_detail, '| tm聚合', drift.err_tm, '| td聚合', drift.err_td)

// 按 token_id+source+日/分 与聚合的键一一对应，验证重建可行（明细是唯一事实来源）
const rows = db.prepare(`
  select count(distinct token_remark || '|' || source) combos,
         count(*) day_combos
  from (select distinct token_remark, source, day from requests)
`).get()
console.log('distinct token|source 组合:', rows.combos, '— 可从明细完整重建')

// 四桶相加 vs 总输入（抽查最坏情形：cache_input_reported 聚合位也可能错位）
const sample = db.prepare(`
  select ifnull(sum(input),0) inp, ifnull(sum(uncached),0) unc,
         ifnull(sum(output),0) outp, ifnull(sum(cache_read),0) cr,
         ifnull(sum(cache_input),0) ci, ifnull(sum(cache_input_reported),0) cir,
         ifnull(sum(cost),0) cost
  from rollup_token_day
`).get()
const detail = db.prepare(`
  select ifnull(sum(coalesce(input_tokens,0)+ifnull(cache_read_tokens,0)*0),0) unused,
         ifnull(sum(input_tokens),0) inp,
         ifnull(sum(uncached_input_tokens),0) unc,
         ifnull(sum(output_tokens),0) outp,
         ifnull(sum(cache_read_tokens),0) cr,
         ifnull(sum(cache_input_tokens),0) ci,
         ifnull(sum(cache_input_reported),0) cir,
         ifnull(sum(cost),0) cost
  from requests
`).get()
console.log('token日聚合: 输入', sample.inp, '未缓存', sample.unc, '输出', sample.outp, '读', sample.cr, '输入缓存', sample.ci, 'reported', sample.cir, '成本', sample.cost)
console.log('明细       : 输入', detail.inp, '未缓存', detail.unc, '输出', detail.outp, '读', detail.cr, '输入缓存', detail.ci, 'reported', detail.cir, '成本', detail.cost)
