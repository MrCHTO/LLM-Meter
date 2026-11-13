/**
 * 端到端核对：起假上游 + 起真实应用，穿过代理发请求，再核对落盘数字。
 * 用法：node test/e2e.mjs
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

const ROOT = process.cwd()
/** 临时档案目录：不覆盖用户真实配置 */
const PROFILE = mkdtempSync(join(tmpdir(), 'llmmeter-e2e-'))
const DATA = join(PROFILE, 'data')
let TOKEN = 'deadbeefdeadbeefdeadbeefdeadbeef'
const PROXY = 'http://127.0.0.1:8787'
const UPSTREAM = 'http://127.0.0.1:18999'

const results = []
function check(name, pass, detail = '') {
  results.push({ name, pass, detail })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function seed() {
  if (existsSync(DATA)) rmSync(DATA, { recursive: true, force: true })
  mkdirSync(DATA, { recursive: true })
  const raw = `raw:${Buffer.from('sk-good').toString('base64')}`
  const day = new Date()
  const p = (n) => String(n).padStart(2, '0')
  writeFileSync(
    join(DATA, 'config.json'),
    JSON.stringify(
      {
        version: 1,
        providers: [
          { id: 'p1', name: '行动', baseUrl: UPSTREAM, format: 'openai', keyCipher: raw, enabled: true, createdAt: 1 },
          {
            id: 'p2',
            name: 'Anthropic 中转',
            baseUrl: UPSTREAM,
            format: 'anthropic',
            keyCipher: raw,
            enabled: true,
            createdAt: 2
          }
        ],
        models: [
          {
            id: 'm1',
            providerId: 'p1',
            upstreamModel: 'gpt-4o-mini',
            alias: 'gpt-mini',
            enabled: true,
            watch: true,
            priceIn: 1,
            priceOut: 2,
            priceCacheRead: 0.1,
            priceCacheWrite: 1.25,
            currency: 'CNY',
            dailyBudget: 5,
            sort: 0,
            createdAt: 1
          },
          {
            id: 'm2',
            providerId: 'p2',
            upstreamModel: 'claude-sonnet-4-5',
            alias: 'my-claude',
            enabled: true,
            watch: true,
            priceIn: 3,
            priceOut: 15,
            priceCacheRead: 0.3,
            priceCacheWrite: 3.75,
            currency: 'CNY',
            dailyBudget: null,
            sort: 1,
            createdAt: 2
          }
        ],
        settings: {
          port: 8787,
          localToken: TOKEN,
          retentionDays: 30,
          rollupRetentionDays: 365,
          overlay: { x: 120, y: 120, width: 320, visible: true },
          overlayOpacity: 92,
          pauseProbe: false,
          startMinimized: false
        }
      },
      null,
      2
    ),
    'utf8'
  )
  return `${day.getFullYear()}-${p(day.getMonth() + 1)}-${p(day.getDate())}`
}

/** 直接读库校验，库在 <profile>/data/llm-meter.db */
function dbRows(sql, ...params) {
  const file = join(DATA, 'llm-meter.db')
  if (!existsSync(file)) return []
  const { DatabaseSync } = require('node:sqlite')
  const conn = new DatabaseSync(file, { readOnly: true })
  try {
    return conn.prepare(sql).all(...params)
  } finally {
    conn.close()
  }
}

async function call(path, { method = 'POST', body, token = TOKEN, raw } = {}) {
  const headers = { 'content-type': 'application/json' }
  if (token) headers.authorization = `Bearer ${token}`
  const res = await fetch(`${PROXY}${path}`, {
    method,
    headers,
    body: method === 'GET' ? undefined : raw ?? JSON.stringify(body)
  })
  const text = await res.text()
  return { status: res.status, text }
}

async function waitFor(fn, label, timeout = 25_000) {
  const until = Date.now() + timeout
  while (Date.now() < until) {
    try {
      if (await fn()) return true
    } catch {
      /* 继续等 */
    }
    await sleep(400)
  }
  throw new Error(`超时：${label}`)
}

const day = seed()

const upstream = spawn(process.execPath, [join(ROOT, 'test', 'fake-upstream.mjs'), '18999'], { stdio: 'inherit' })
await sleep(600)

const electron = spawn(join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'), ['.', `--user-data-dir=${PROFILE}`], {
  cwd: ROOT,
  env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' },
  stdio: ['ignore', 'pipe', 'pipe']
})
const appLog = []
electron.stdout.on('data', (d) => appLog.push(d.toString()))
electron.stderr.on('data', (d) => appLog.push(d.toString()))

try {
  await waitFor(async () => {
    const res = await fetch(`${PROXY}/healthz`)
    return res.ok
  }, '代理就绪')

  // 种子里的 hex token 会被迁移成 sk- 签名票，改成读迁移后的实际值
  TOKEN = JSON.parse(readFileSync(join(DATA, 'config.json'), 'utf8')).settings.localToken
  check('本地 token 已迁移为 sk- 且带签名', /^sk-[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(TOKEN), TOKEN.slice(0, 14))

  const models = await call('/openai/v1/models', { method: 'GET' })
  check('带 token 的 GET /openai/v1/models 透传', models.status === 200 && models.text.includes('gpt-4o-mini'), `${models.status}`)

  const noAuth = await call('/openai/v1/chat/completions', { body: { model: 'gpt-mini' }, token: '' })
  check('缺 token 返回 401', noAuth.status === 401, `${noAuth.status}`)

  const unknown = await call('/openai/v1/chat/completions', { body: { model: 'nope' } })
  check('未登记模型返回 404', unknown.status === 404, unknown.text.slice(0, 60))

  const wrongFormat = await call('/openai/v1/chat/completions', { body: { model: 'my-claude' } })
  check('格式不匹配返回 404', wrongFormat.status === 404, wrongFormat.text.slice(0, 60))

  const stream = await call('/openai/v1/chat/completions', {
    body: { model: 'gpt-mini', stream: true, messages: [{ role: 'user', content: 'hi' }] }
  })
  check('流式请求成功且内容透传', stream.status === 200 && stream.text.includes('你好'), `${stream.status}`)
  check('流式响应保留 [DONE]', stream.text.includes('[DONE]'))

  await call('/openai/v1/chat/completions', {
    body: { model: 'gpt-mini', stream: true, messages: [{ role: 'user', content: 'hi' }] }
  })

  const anthropic = await call('/anthropic/v1/messages', {
    body: { model: 'my-claude', max_tokens: 32, stream: true, messages: [{ role: 'user', content: 'hi' }] }
  })
  check('Anthropic 格式请求成功', anthropic.status === 200 && anthropic.text.includes('message_stop'), `${anthropic.status}`)
  await call('/anthropic/v1/messages', {
    body: { model: 'my-claude', max_tokens: 32, stream: true, messages: [{ role: 'user', content: 'hi' }] }
  })

  // 不带 stream 字段但上游回 SSE，要按响应头识别
  const anthropicPlain = await call('/anthropic/v1/messages', {
    body: { model: 'my-claude', max_tokens: 32, messages: [{ role: 'user', content: 'hi' }] }
  })
  check('缺省 stream 时仍按 SSE 解析', anthropicPlain.status === 200, `${anthropicPlain.status}`)

  const plain = await call('/openai/v1/chat/completions', {
    body: { model: 'gpt-mini', stream: false, messages: [{ role: 'user', content: 'hi' }] }
  })
  check('非流式请求成功', plain.status === 200 && plain.text.includes('非流式回答'), `${plain.status}`)

  const boom = await call('/openai/v1/boom', { body: { model: 'gpt-mini' } })
  check('上游 5xx 原样回传并计为 upstream_5xx', boom.status === 500 && boom.text.includes('boom'), `${boom.status}`)

  const missing = await call('/openai/v1/nope-path', { body: { model: 'gpt-mini' } })
  check('上游 404 原样回传', missing.status === 404, `${missing.status}`)

  await sleep(1200)
  const rows = dbRows('select * from requests order by ts asc')
  check('明细写进了数据库', rows.length > 0, `count=${rows.length}`)

  const streamRows = rows.filter((r) => r.stream === 1 && r.ok === 1 && r.alias === 'gpt-mini')
  check('流式请求两行落库', streamRows.length === 2, `count=${streamRows.length}`)
  const first = streamRows[0]
  const second = streamRows[1]
  check(
    '首次缓存读 0，第二次读到 1080',
    first?.cache_read_tokens === 0 && second?.cache_read_tokens === 1080,
    `${first?.cache_read_tokens} → ${second?.cache_read_tokens}`
  )
  check('输出 token 记录正确', first?.output_tokens === 42, `${first?.output_tokens}`)
  check('输入 token 记录正确', first?.input_tokens === 1200, `${first?.input_tokens}`)
  check('TTFT 已测量', typeof first?.ttft_ms === 'number' && first.ttft_ms >= 0, `${first?.ttft_ms}`)
  const expectedCost = ((1200 - 1080) * 1 + 42 * 2 + 1080 * 0.1) / 1_000_000
  check('成本按单价折算', Math.abs((second?.cost ?? 0) - expectedCost) < 1e-9, `${second?.cost} vs ${expectedCost}`)

  const aRows = rows.filter((r) => r.alias === 'my-claude')
  check('Anthropic 缓存读落库', aRows.at(-1)?.cache_read_tokens === 1080, `${aRows.at(-1)?.cache_read_tokens}`)
  check('Anthropic 输入补足为总量', aRows.at(-1)?.input_tokens === 1200, `${aRows.at(-1)?.input_tokens}`)
  check('Anthropic 输出 token 取自 message_delta', aRows.at(-1)?.output_tokens === 33, `${aRows.at(-1)?.output_tokens}`)

  const plainRow = rows.filter((r) => r.ok === 1 && r.stream === 0 && r.alias === 'gpt-mini' && r.input_tokens > 0).at(-1)
  check('非流式记录 usage 且 TTFT 为空', plainRow?.input_tokens === 900 && plainRow?.ttft_ms === null, `${plainRow?.input_tokens}`)

  const failRow = rows.find((r) => r.ok === 0)
  check('失败也落库并带错误类型', Boolean(failRow?.error_kind), `${failRow?.error_kind}`)

  const minute = dbRows('select * from rollup_minute where model_id = ?', 'm1')
  const minuteCost = minute.reduce((sum, r) => sum + Number(r.cost ?? 0), 0)
  check('分钟聚合同步写入', minute.length > 0 && minuteCost > 0, `count=${minute.length} cost=${minuteCost}`)
  const dayRow = dbRows('select * from rollup_day where model_id = ?', 'm1')
  check('日聚合同步写入', dayRow.length > 0 && Number(dayRow[0]?.requests) > 0, `count=${dayRow.length}`)

  check('渲染进程未白屏（加载产物）', appLog.join('').includes('overlay') || existsSync(join(ROOT, 'out', 'renderer', 'index.html')))
  const crash = appLog.join('').match(/Uncaught|ERR_FILE_NOT_FOUND|Failed to load/g)
  check('主进程日志无加载错误', !crash, crash ? String(crash) : '')
} catch (err) {
  check('整体执行', false, err.message)
  console.log(appLog.join('').slice(-3000))
} finally {
  electron.kill()
  upstream.kill()
  await sleep(600)
  if (process.env.KEEP_PROFILE) console.log('profile:', PROFILE)
  else {
    // sqlite 可能还攥着文件，退几次再放弃
    for (let i = 0; i < 6; i++) {
      try {
        rmSync(PROFILE, { recursive: true, force: true })
        break
      } catch {
        await sleep(400)
      }
    }
  }
}

const failed = results.filter((r) => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} 通过`)
process.exit(failed.length === 0 ? 0 : 1)
