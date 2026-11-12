/**
 * 不碰用户的 config，直接对已配置的供应商跑一次「测试」按钮背后的 IPC。
 * 用法：node test/provider-test.mjs [exePath]
 */
import { spawn } from 'node:child_process'
import { join } from 'node:path'

const ROOT = process.cwd()
const exe = process.argv[2] ?? join(process.env.LOCALAPPDATA ?? '', 'Programs', 'LLM Meter', 'LLM Meter.exe')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const child = spawn(exe, ['--remote-debugging-port=9444'], { stdio: ['ignore', 'pipe', 'pipe'] })
const log = []
child.stdout.on('data', (d) => log.push(d.toString()))
child.stderr.on('data', (d) => log.push(d.toString()))

async function target() {
  const until = Date.now() + 25_000
  while (Date.now() < until) {
    try {
      const list = await fetch('http://127.0.0.1:9444/json/list').then((r) => r.json())
      const hit = list.find((t) => t.type === 'page' && t.url.includes('index.html'))
      if (hit) return hit
    } catch {
      /* 等 */
    }
    await sleep(400)
  }
  throw new Error('等不到主窗')
}

try {
  const page = await target()
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => {
    ws.onopen = res
    ws.onerror = rej
  })
  let id = 0
  const pending = new Map()
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data)
    const p = pending.get(m.id)
    if (!p) return
    pending.delete(m.id)
    m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result)
  }
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const msgId = ++id
      pending.set(msgId, { resolve, reject })
      ws.send(JSON.stringify({ id: msgId, method, params }))
    })

  const evaluate = async (expr) => {
    const res = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
    if (res.exceptionDetails) throw new Error(res.exceptionDetails.text)
    return res.result.value
  }

  // 等页面真正加载完，避免上下文被重建
  for (let i = 0; i < 40; i++) {
    try {
      if (await evaluate('typeof window.api === "object"')) break
    } catch {
      /* 还在导航 */
    }
    await sleep(500)
  }
  await send('Runtime.enable')

  const providers = await evaluate('(async()=>(await window.api.config()).data.providers)()')
  console.log('已配置供应商:', providers.map((p) => `${p.name} → ${p.baseUrl}`).join(' | '))
  if (providers.length === 0) throw new Error('还没有供应商')

  let failed = 0
  for (const p of providers) {
    const res = await evaluate(`(async()=>JSON.stringify(await window.api.testProvider(${JSON.stringify(p.id)})))()`)
    const out = JSON.parse(res)
    console.log(`${p.name}: ok=${out.ok} status=${out.data?.status} message=${out.data?.message}`)
    if (!out.data?.ok) failed++
  }
  ws.close()
  process.exitCode = failed ? 1 : 0
} catch (err) {
  console.log('FAIL', err.message)
  console.log(log.join('').slice(-1200))
  process.exitCode = 1
} finally {
  child.kill()
  await sleep(400)
}
