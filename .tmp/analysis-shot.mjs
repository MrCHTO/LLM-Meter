import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
const child = spawn(process.cwd() + '/node_modules/electron/dist/electron.exe', ['.', '--remote-debugging-port=9336'], { stdio: 'ignore', cwd: process.cwd() })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let ws
try {
  let page
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:9336/json')).json()
      page = list.find((p) => p.type === 'page' && p.url.includes('index.html'))
      if (page) break
    } catch {}
    await sleep(500)
  }
  ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j })
  let id = 0; const pending = new Map()
  ws.onmessage = (e) => { const m = JSON.parse(e.data); pending.get(m.id)?.(m); pending.delete(m.id) }
  const send = (method, params) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })) })
  const evalJs = async (expr, awaitPromise = false) => (await send('Runtime.evaluate', { expression: expr, awaitPromise, returnByValue: true })).result?.result?.value
  await sleep(2500)
  await evalJs("document.querySelector('.tab:nth-child(2)')?.click()")
  await sleep(1500)
  const r = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync('test/shots/analysis-head.png', Buffer.from(r.result.data, 'base64'))
  console.log('shot')
} finally { ws?.close(); child.kill() }
