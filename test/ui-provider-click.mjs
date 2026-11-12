/** 点界面上的「测试」按钮，确认 toast 文案可读。用法：node test/ui-provider-click.mjs */
import { spawn } from 'node:child_process'
import { join } from 'node:path'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const exe = join(process.env.LOCALAPPDATA ?? '', 'Programs', 'LLM Meter', 'LLM Meter.exe')
const child = spawn(exe, ['--remote-debugging-port=9555'], { stdio: 'ignore' })

const page = await (async () => {
  const until = Date.now() + 25_000
  while (Date.now() < until) {
    try {
      const list = await fetch('http://127.0.0.1:9555/json/list').then((r) => r.json())
      const hit = list.find((t) => t.type === 'page' && t.url.includes('index.html'))
      if (hit) return hit
    } catch {
      /* 等 */
    }
    await sleep(400)
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
  m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result)
}
const evaluate = async (expr, attempts = 3) => {
  for (let i = 0; i < attempts; i++) {
    try {
      const msgId = ++id
      const res = await new Promise((resolve, reject) => {
        pending.set(msgId, { resolve, reject })
        ws.send(
          JSON.stringify({
            id: msgId,
            method: 'Runtime.evaluate',
            params: { expression: expr, awaitPromise: true, returnByValue: true }
          })
        )
      })
      return res.result.value
    } catch (err) {
      if (i === attempts - 1) throw err
      await sleep(600)
    }
  }
}

for (let i = 0; i < 40; i++) {
  let ready = false
  try {
    ready = Boolean(await evaluate("!!document.querySelector('.tab')"))
  } catch {
    /* 还在导航 */
  }
  if (ready) break
  await sleep(500)
}

await evaluate("document.querySelector('.tab:nth-child(2)').click()")
await sleep(1500)
console.log('当前页签:', await evaluate("document.querySelector('.tab[aria-selected=\"true\"]')?.innerText ?? '(无)'"))
console.log('正文头:', (await evaluate('document.body.innerText')).slice(0, 120).replace(/\n/g, ' | '))
const buttons = await evaluate(
  "JSON.stringify([...document.querySelectorAll('tbody tr td:last-child button')].map(b => b.innerText))"
)
console.log('行内按钮:', buttons)
await evaluate("document.querySelectorAll('tbody tr td:last-child button')[0].click()")
let toast = ''
for (let i = 0; i < 14; i++) {
  await sleep(300)
  toast = await evaluate("document.querySelector('.toast')?.innerText ?? ''")
  if (toast) break
}
console.log('toast:', toast || '(没有 toast)')
console.log(toast.includes('{') ? 'FAIL 仍是原始 JSON' : 'PASS 提示可读')
ws.close()
child.kill()
process.exitCode = toast.includes('{') ? 1 : 0
