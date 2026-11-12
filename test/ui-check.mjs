/**
 * 通过 CDP 连上真实窗口，核对界面渲染与关键交互，并截图。
 * 用法：node test/ui-check.mjs
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const DATA = join(process.env.APPDATA ?? '', 'llm-meter', 'data')
const SHOTS = join(ROOT, 'test', 'shots')
const TOKEN = 'cafebabecafebabecafebabecafebabe'
const KEY = process.env.KEY ?? 'sk-YxfyzJCnbzjFzvFCF3Fd6eE84e414dA1AcEa60B3161fE535'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
const check = (name, pass, detail = '') => {
  results.push(pass)
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

if (existsSync(SHOTS)) rmSync(SHOTS, { recursive: true, force: true })
mkdirSync(SHOTS, { recursive: true })

// 造一点历史，让看板不是空的
const now = new Date()
const p = (n) => String(n).padStart(2, '0')
const day = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`
mkdirSync(join(DATA, 'events'), { recursive: true })
mkdirSync(join(DATA, 'rollup'), { recursive: true })
const t = Date.now() - 60_000
const rows = [0, 1, 2].map((i) => ({
  id: `seed-${i}`,
  ts: t + i * 5000,
  source: 'proxy',
  modelId: 'm1',
  alias: 'my-claude',
  providerId: 'p1',
  status: 200,
  ok: true,
  errorKind: null,
  stream: true,
  ttftMs: 380 + i * 10,
  durationMs: 7400,
  inputTokens: 1200,
  outputTokens: 460,
  cacheReadTokens: i === 0 ? 0 : 1080,
  cacheWriteTokens: 0,
  cost: 0.0043,
  currency: 'USD'
}))
writeFileSync(join(DATA, 'events', `${day}.jsonl`), rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8')
const minute = String(Math.floor(t / 60000) * 60000)
writeFileSync(
  join(DATA, 'rollup', `${day}.json`),
  JSON.stringify({
    [minute]: {
      m1: { out: 1380, req: 3, err: 0, cost: 0.0129, input: 3600, cacheRead: 2160, cacheWrite: 0 }
    }
  }),
  'utf8'
)
writeFileSync(
  join(DATA, 'config.json'),
  JSON.stringify({
    version: 1,
    providers: [
      {
        id: 'p1',
        name: '我的中转站',
        baseUrl: 'http://10.130.6.32:3001/v1',
        format: 'openai',
        keyCipher: `raw:${Buffer.from(KEY).toString('base64')}`,
        enabled: true,
        createdAt: 1
      }
    ],
    models: [
      {
        id: 'm1',
        providerId: 'p1',
        upstreamModel: 'DeepSeek-V4.1-Flash',
        alias: 'my-claude',
        enabled: true,
        watch: true,
        priceIn: 3,
        priceOut: 15,
        priceCacheRead: 0.3,
        priceCacheWrite: 3.75,
        currency: 'USD',
        dailyBudget: 5,
        sort: 0,
        createdAt: 1
      }
    ],
    settings: {
      port: 8787,
      localToken: TOKEN,
      retentionDays: 30,
      rollupRetentionDays: 365,
      overlay: { x: 160, y: 160, width: 320, visible: true },
      overlayOpacity: 92,
      pauseProbe: false,
      startMinimized: false
    }
  }),
  'utf8'
)

const electron = spawn(
  process.env.APP_EXE ?? join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'),
  process.env.APP_EXE ? ['--remote-debugging-port=9333'] : ['.', '--remote-debugging-port=9333'],
  { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] }
)
const log = []
electron.stdout.on('data', (d) => log.push(d.toString()))
electron.stderr.on('data', (d) => log.push(d.toString()))

async function targets() {
  const res = await fetch('http://127.0.0.1:9333/json/list')
  return res.json()
}

async function waitTarget(match, timeout = 25_000) {
  const until = Date.now() + timeout
  while (Date.now() < until) {
    try {
      const list = await targets()
      const found = list.find((t) => t.type === 'page' && t.url.includes(match))
      if (found) return found
    } catch {
      /* 等 */
    }
    await sleep(400)
  }
  throw new Error(`等不到窗口 ${match}`)
}

async function session(target) {
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = reject
  })
  let id = 0
  const pending = new Map()
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data)
    const entry = pending.get(msg.id)
    if (!entry) return
    pending.delete(msg.id)
    if (msg.error) entry.reject(new Error(msg.error.message))
    else entry.resolve(msg.result)
  }
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const msgId = ++id
      pending.set(msgId, { resolve, reject })
      ws.send(JSON.stringify({ id: msgId, method, params }))
    })
  return {
    send,
    async eval(expr, awaitPromise = false) {
      const res = await send('Runtime.evaluate', { expression: expr, awaitPromise, returnByValue: true })
      if (res.exceptionDetails) throw new Error(res.exceptionDetails.text)
      return res.result.value
    },
    async shot(file) {
      const res = await send('Page.captureScreenshot', { format: 'png' })
      writeFileSync(join(SHOTS, file), Buffer.from(res.data, 'base64'))
    },
    close: () => ws.close()
  }
}

try {
  const main = await waitTarget('index.html')
  const s = await session(main)
  await s.send('Runtime.enable')
  for (let i = 0; i < 40; i++) {
    if (await s.eval("!!document.querySelector('.tab')")) break
    await sleep(400)
  }
  await sleep(800)

  check('主窗标题正确', (await s.eval('document.title')) === 'LLM Meter')
  check('表头三页签齐全', (await s.eval("document.querySelectorAll('.tab').length")) === 3)
  check('看板有 KPI 卡', (await s.eval("document.querySelectorAll('.kpi .tile').length")) === 4)
  check('模型行渲染出来', (await s.eval("document.querySelectorAll('tbody tr').length")) >= 1)
  check('迷你曲线有柱子', (await s.eval("document.querySelectorAll('.bar i').length")) > 0)
  check('命中率显示为百分比', /%/.test(await s.eval("document.querySelector('tbody tr td:nth-child(4)')?.innerText ?? ''")))
  check('预算条出现', (await s.eval("document.querySelectorAll('.meter').length")) > 0)
  check('代理状态点在跑', (await s.eval("document.querySelector('.dot')?.className")) === 'dot on')
  const sandboxOk = await s.eval("typeof window.api === 'object' && typeof window.api.config === 'function'")
  check('contextIsolation 下 preload 正常暴露', sandboxOk === true)
  await s.shot('dashboard.png')

  await s.eval("document.querySelector('.tab:nth-child(2)')?.click()")
  await sleep(600)
  check('模型页列出供应商', (await s.eval("document.querySelectorAll('tbody tr').length")) >= 1)
  check('供应商显示掩码 Key', /••••/.test(await s.eval("document.body.innerText")))
  await s.shot('models.png')

  await s.eval("document.querySelector('.tab:nth-child(3)')?.click()")
  await sleep(600)
  check('设置页给出本地入口', (await s.eval("document.body.innerText")).includes('127.0.0.1'))
  await s.shot('settings.png')

  await s.eval("document.querySelector('.tab:nth-child(1)')?.click()")
  await sleep(400)

  // 真的点「测速」按钮，等结果行出现
  await s.eval("document.querySelector('tbody tr td:last-child button:nth-child(2)')?.click()")
  let bodyText = ''
  for (let i = 0; i < 45; i++) {
    await sleep(1500)
    bodyText = await s.eval('document.body.innerText')
    if (bodyText.includes('冷：')) break
  }
  check('测速结果行渲染出来', bodyText.includes('冷：'))
  check('测速结果带缓存结论', /缓存(有效|未生效)/.test(bodyText))
  await s.shot('probe.png')

  await s.eval("document.querySelector('tbody tr td:last-child button:nth-child(1)')?.click()")
  await sleep(900)
  check('明细可展开且有行', (await s.eval("document.querySelectorAll('.detail table tbody tr').length")) > 0)
  await s.shot('detail.png')

  s.close()

  const ov = await waitTarget('overlay.html')
  const o = await session(ov)
  await o.send('Runtime.enable')
  await sleep(1200)
  check('悬浮窗列出被监视模型', (await o.eval("document.querySelectorAll('.orow').length")) === 1)
  check('悬浮窗有底部汇总', (await o.eval("document.querySelector('.ofoot')?.innerText ?? ''")).includes('今日'))
  check('悬浮窗可透明（面板存在）', (await o.eval("!!document.querySelector('.panel')")) === true)
  const box = await o.eval("JSON.stringify({x:window.screenX,y:window.screenY,w:window.outerWidth,h:window.outerHeight})")
  const parsed = JSON.parse(box)
  check('悬浮窗尺寸非零且位置已恢复', parsed.w > 200 && parsed.x > 0 && parsed.y > 0, box)
  await o.shot('overlay.png')
  o.close()

  const cfgFile = JSON.parse(readFileSync(join(DATA, 'config.json'), 'utf8'))
  check('悬浮窗位置已持久化', cfgFile.settings.overlay.x > 0, `${cfgFile.settings.overlay.x},${cfgFile.settings.overlay.y}`)
} catch (err) {
  check('整体执行', false, err.message)
  console.log(log.join('').slice(-2000))
} finally {
  electron.kill()
  await sleep(500)
}

const failed = results.filter((x) => !x).length
console.log(`\n${results.length - failed}/${results.length} 通过，截图在 test/shots`)
process.exit(failed ? 1 : 0)
