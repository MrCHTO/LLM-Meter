/** 打开局域网访问，验证 LAN 地址真的能连，再读回状态。 */
import { spawn } from 'node:child_process'
import { join } from 'node:path'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const exe = join(process.env.LOCALAPPDATA ?? '', 'Programs', 'LLM Meter', 'LLM Meter.exe')
const child = spawn(exe, ['--remote-debugging-port=9811'], { stdio: 'ignore' })

const page = await (async () => {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await fetch('http://127.0.0.1:9811/json/list').then((r) => r.json())
      const hit = list.find((t) => t.type === 'page' && t.url.includes('index.html'))
      if (hit) return hit
    } catch {
      /* 等 */
    }
    await sleep(500)
  }
  throw new Error('等不到主窗')
})()

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
  p(m.result)
}
const evaluate = async (expr) => {
  const msgId = ++id
  const res = await new Promise((resolve) => {
    pending.set(msgId, resolve)
    ws.send(
      JSON.stringify({ id: msgId, method: 'Runtime.evaluate', params: { expression: expr, awaitPromise: true, returnByValue: true } })
    )
  })
  return res?.result?.value
}

for (let i = 0; i < 40; i++) {
  if (await evaluate('typeof window.api === "object"')) break
  await sleep(500)
}

const info = JSON.parse(
  await evaluate('(async()=>{const c=(await window.api.config()).data;return JSON.stringify({port:c.settings.port,lanIp:c.settings.lanIp,token:c.settings.localToken})})()')
)
console.log('lanIp:', info.lanIp, 'port:', info.port)

const localOk = await evaluate("(async()=>(await (await window.api.updateSettings({allowLan:true})).ok))()")
console.log('开启局域网:', localOk)
await sleep(2500)

const lanUrl = `http://${info.lanIp}:${info.port}/healthz`
const localUrl = `http://127.0.0.1:${info.port}/healthz`
for (const [label, url] of [
  ['本机 healthz', localUrl],
  ['局域网 healthz', lanUrl]
]) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) })
    console.log(label, res.status)
  } catch (err) {
    console.log(label, 'fail', err.message)
  }
}

// 用局域网地址打一次真实转发
try {
  const res = await fetch(`http://${info.lanIp}:${info.port}/openai/v1/models`, {
    headers: { authorization: `Bearer ${info.token}` },
    signal: AbortSignal.timeout(20000)
  })
  console.log('局域网转发 /v1/models', res.status)
} catch (err) {
  console.log('局域网转发失败', err.message)
}

ws.close()
await sleep(300)
child.kill()
