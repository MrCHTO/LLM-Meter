/** 在真实库副本上实证 renameTokenRemark 是否能把 默认→Zcode 带走历史行。 */
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { cpSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'

const src = process.env.APPDATA + '/llm-meter/data/llm-meter.db'
const root = mkdtempSync(join(tmpdir(), 'renametest-'))
const dest = join(root, 'copy.db')
cpSync(src, dest)

const db = new DatabaseSync(dest)
const TOKEN_ID = '266bea53-d985-4787-a121-d37a908fec82'
const from = '默认', to = 'Zcode'

console.log('改前明细:', JSON.stringify(db.prepare('select token_remark, count(*) n from requests group by token_remark').all()))
console.log('改前聚合:', JSON.stringify(db.prepare('select token_remark, count(*) n from rollup_token_day group by token_remark').all()))

db.exec('begin')
try {
  db.prepare('update requests set token_remark = ? where token_id = ?').run(to, TOKEN_ID)
  console.log('明细 update 影响行数:', db.prepare('select changes() c').get().c)
  // 只验证第一步，不做聚合合并（聚合合并逻辑另有单测覆盖）
  db.exec('commit')
} catch (err) {
  db.exec('rollback')
  console.log('事务失败:', String(err))
}
console.log('改后明细:', JSON.stringify(db.prepare('select token_remark, count(*) n from requests group by token_remark').all()))
db.close()
rmSync(root, { recursive: true, force: true })
