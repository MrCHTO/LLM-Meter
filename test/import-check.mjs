/**
 * 已安装/打包构建的旧数据导入回归：给一个带 events/rollup 的临时档案，起应用，
 * 断言明细进库、旧目录被改名留底、再启动不重复导入。
 * 用法：node test/import-check.mjs [exe] [备份目录]
 */
import { spawn } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const ROOT = process.cwd()
const EXE = process.argv[2] ?? join(ROOT, 'dist', 'win-unpacked', 'LLM Meter.exe')
const SRC = process.argv[3]
const TOKEN = 'feedfacefeedfacefeedfacefeedface'
const PORT = 8899

if (!existsSync(SRC)) {
  console.error(`找不到备份目录：${SRC}`)
  process.exit(2)
}

const results = []
function check(name, pass, detail = '') {
  results.push({ name, pass })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const profile = mkdtempSync(join(tmpdir(), 'llmmeter-import-'))
const data = join(profile, 'data')
mkdirSync(join(data, 'events'), { recursive: true })
for (const dir of ['events', 'rollup']) {
  if (!existsSync(join(SRC, dir))) continue
  cpSync(join(SRC, dir), join(data, dir), { recursive: true })
}
const srcLines = readdirSync(join(data, 'events'))
  .filter((n) => n.endsWith('.jsonl'))
  .reduce((n, f) => n + readFileSync(join(data, 'events', f), 'utf8').split('\n').filter((l) => l.trim()).length, 0)

writeFileSync(
  join(data, 'config.json'),
  JSON.stringify({
    version: 1,
    providers: [],
    models: [],
    settings: { port: PORT, localToken: TOKEN, retentionDays: 30, rollupRetentionDays: 365 }
  }),
  'utf8'
)

function countRows() {
  const file = join(data, 'llm-meter.db')
  if (!existsSync(file)) return -1
  const { DatabaseSync } = require('node:sqlite')
  const conn = new DatabaseSync(file, { readOnly: true })
  try {
    return conn.prepare('select count(*) c from requests').get().c
  } catch {
    return -1
  } finally {
    conn.close()
  }
}

async function launch() {
  const child = spawn(EXE, [`--user-data-dir=${profile}`], { stdio: ['ignore', 'pipe', 'pipe'] })
  const log = []
  child.stdout.on('data', (d) => log.push(d.toString()))
  child.stderr.on('data', (d) => log.push(d.toString()))
  const until = Date.now() + 25_000
  while (Date.now() < until) {
    if (countRows() > 0) break
    if (child.exitCode !== null) break
    await sleep(400)
  }
  return { child, log }
}

const first = await launch()
try {
  const rows = countRows()
  check('明细已导入数据库', rows > 0, `rows=${rows}，源 ${srcLines} 行`)
  check('行数与源一致', rows === srcLines, `${rows} vs ${srcLines}`)
  check('events 目录已改名', !existsSync(join(data, 'events')))
  const kept = join(data, 'legacy-imported')
  check('旧文件留底在 legacy-imported', existsSync(kept) && readdirSync(kept).length > 0)
  const minute = (() => {
    const { DatabaseSync } = require('node:sqlite')
    const conn = new DatabaseSync(join(data, 'llm-meter.db'), { readOnly: true })
    try {
      return conn.prepare('select count(*) c from rollup_minute').get().c
    } finally {
      conn.close()
    }
  })()
  check('分钟聚合已生成', minute > 0, `count=${minute}`)
  const crash = first.log.join('').match(/Uncaught|ERR_FILE_NOT_FOUND|Failed to load/g)
  check('主进程无加载错误', !crash, crash ? String(crash) : '')
} catch (err) {
  check('导入回归', false, err.message)
} finally {
  first.child.kill()
  await sleep(900)
}

// 用同一个档案再起一次，确认不重复导入
const second = await launch()
try {
  check('二次启动不重复导入', countRows() === srcLines, `rows=${countRows()}`)
} finally {
  second.child.kill()
  await sleep(800)
  for (let i = 0; i < 6; i++) {
    try {
      rmSync(profile, { recursive: true, force: true })
      break
    } catch {
      await sleep(400)
    }
  }
}

const failed = results.filter((r) => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} 通过`)
process.exit(failed.length === 0 ? 0 : 1)
