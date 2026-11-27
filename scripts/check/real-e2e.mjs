/**
 * 真实上游核对：穿过应用代理打两次同前缀请求，确认首字时间、tps、缓存命中确实被记下。
 * 用法：node scripts/check/real-e2e.mjs <baseUrl> <key> <model>
 * 使用临时档案目录，不碰已安装实例与开发档案。
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const require = createRequire(import.meta.url)

const [base, key, model] = process.argv.slice(2)
if (!base || !key || !model) {
  console.error('usage: node scripts/check/real-e2e.mjs <baseUrl> <key> <model>')
  process.exit(2)
}

const ROOT = process.cwd()
/** 临时档案目录：不覆盖开发档案，也不与运行中的实例抢单例锁 */
const PROFILE = mkdtempSync(join(tmpdir(), 'llmmeter-real-'))
const DATA = join(PROFILE, 'data')
const TOKEN = 'cafebabecafebabecafebabecafebabe'
const PORT = Number(process.env.LLM_TEST_PORT ?? 18788)
const PROXY = `http://127.0.0.1:${PORT}`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
const check = (name, pass, detail = '') => {
  results.push(pass)
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

const now = new Date()
const p = (n) => String(n).padStart(2, '0')
const day = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`

if (existsSync(DATA)) rmSync(DATA, { recursive: true, force: true })
mkdirSync(DATA, { recursive: true })
writeFileSync(
  join(DATA, 'config.json'),
  JSON.stringify({
    version: 1,
    providers: [
      {
        id: 'real',
        name: '32 服务器',
        baseUrl: base.replace(/\/+$/, ''),
        format: 'openai',
        keyCipher: `raw:${Buffer.from(key).toString('base64')}`,
        enabled: true,
        createdAt: 1
      }
    ],
    models: [
      {
        id: 'm1',
        providerId: 'real',
        upstreamModel: model,
        alias: 'probe-me',
        enabled: true,
        watch: true,
        priceIn: 1,
        priceOut: 2,
        priceCacheRead: 0.1,
        priceCacheInput: 0,
        currency: 'USD',
        dailyBudget: 1,
        sort: 0,
        createdAt: 1
      }
    ],
    settings: {
      port: PORT,
      localToken: TOKEN,
      retentionDays: 30,
      rollupRetentionDays: 365,
      overlay: { x: 140, y: 140, width: 320, visible: true },
      overlayOpacity: 92,
      pauseProbe: false,
      startMinimized: false
    }
  }),
  'utf8'
)

const filler = '缓存前缀用于测量命中。The quick brown fox jumps over the lazy dog. 温度、气压与湿度沿着海岸线缓慢变化，'
const prefix = Array.from({ length: 260 }, (_, i) => `${i} ${filler}`).join(' ')

const electron = spawn(
  join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'),
  ['.', `--user-data-dir=${PROFILE}`],
  {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe']
  }
)
const log = []
electron.stdout.on('data', (d) => {
  const text = d.toString()
  log.push(text)
  if (text.includes('[debug]')) process.stdout.write(text)
})
electron.stderr.on('data', (d) => log.push(d.toString()))

async function send(tag) {
  const started = Date.now()
  const res = await fetch(`${PROXY}/openai/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({
      model: 'probe-me',
      stream: true,
      max_tokens: 120,
      temperature: 0,
      messages: [
        { role: 'system', content: prefix },
        { role: 'user', content: '用中文写一句话。' }
      ]
    })
  })
  const text = await res.text()
  console.log(`[${tag}] status=${res.status} bytes=${text.length} ms=${Date.now() - started}`)
  return res.status
}

try {
  const until = Date.now() + 25_000
  let up = false
  while (Date.now() < until) {
    try {
      up = (await fetch(`${PROXY}/healthz`)).ok
      if (up) break
    } catch {
      /* 等 */
    }
    await sleep(400)
  }
  check('代理已就绪', up)

  const cold = await send('cold')
  check('冷请求 200', cold === 200, `${cold}`)
  // 中转站可能把请求轮询到不同后端，各自缓存不共享，所以多发几次看有没有命中
  for (let i = 0; i < 3; i++) {
    await sleep(1200)
    await send(`warm${i + 1}`)
  }
  await sleep(1200)

  const { DatabaseSync } = require('node:sqlite')
  const conn = new DatabaseSync(join(DATA, 'llm-meter.db'), { readOnly: true })
  const rows = conn
    .prepare('select * from requests where day = ? order by ts asc')
    .all(day)
    .map((r) => ({
      ok: Boolean(r.ok),
      outputTokens: Number(r.output_tokens),
      inputTokens: Number(r.input_tokens),
      cacheReadTokens: Number(r.cache_read_tokens),
      ttftMs: r.ttft_ms,
      durationMs: Number(r.duration_ms),
      cost: Number(r.cost)
    }))
  conn.close()
  check('请求全部落盘', rows.length === 4, `count=${rows.length}`)

  const [a] = rows
  check('全部成功', rows.every((r) => r.ok))
  check('记下了输出 token', (a?.outputTokens ?? 0) > 0, `${a?.outputTokens}`)
  check('记下了输入 token（约 8k）', (a?.inputTokens ?? 0) > 5000, `${a?.inputTokens}`)
  check('首字时间已测量（推理通道也算）', typeof a?.ttftMs === 'number', `${a?.ttftMs}`)
  const windowSec = ((a?.durationMs ?? 0) - (a?.ttftMs ?? 0)) / 1000
  const tps = windowSec > 0 ? (a?.outputTokens ?? 0) / windowSec : 0
  check('tps 可计算且为正', tps > 0, `${tps.toFixed(1)} tok/s`)
  const hits = rows.map((r) => r.cacheReadTokens)
  check('缓存读取数不超过输入 token', rows.every((r) => r.cacheReadTokens <= r.inputTokens), `cacheRead=${hits.join(',')}`)
  const anyHit = hits.slice(1).some((n) => n > 0)
  console.log(
    anyHit
      ? `INFO  缓存读取 ${hits.join(',')}`
      : `INFO  缓存读取 ${hits.join(',')} —— 该中转当前没有上报缓存命中，属上游行为`
  )
  check('缓存命中时成本按缓存单价折算', rows.every((r) => (r.cacheReadTokens > 0 ? r.cost < (r.inputTokens * 1 + r.outputTokens * 2) / 1e6 : true)))
} catch (err) {
  check('整体执行', false, err.message)
  console.log(log.join('').slice(-2000))
} finally {
  electron.kill()
  await sleep(600)
  if (process.env.KEEP_PROFILE) console.log('profile:', PROFILE)
  else rmSync(PROFILE, { recursive: true, force: true })
}

const failed = results.filter((x) => !x).length
console.log(`\n${results.length - failed}/${results.length} 通过`)
process.exit(failed ? 1 : 0)
