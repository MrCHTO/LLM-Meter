/** 读出端口与本地 token，便于用 curl 直连本地代理排查。 */
import { spawn } from 'node:child_process'
import { join } from 'node:path'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const exe = join(process.env.LOCALAPPDATA ?? '', 'Programs', 'LLM Meter', 'LLM Meter.exe')
const child = spawn(exe, ['--remote-debugging-port=9788'], { stdio: 'ignore' })

const page = await (async () => {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await fetch('http://127.0.0.1:9788/json/list').then((r) => r.json())
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

const info = await evaluate(
  '(async()=>{const c=(await window.api.config()).data;return JSON.stringify({port:c.settings.port,token:c.settings.localToken})})()'
)
console.log(info)
ws.close()
await sleep(300)
child.kill()
