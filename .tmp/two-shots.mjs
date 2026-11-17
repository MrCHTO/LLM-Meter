import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
const child = spawn(process.cwd() + '/node_modules/electron/dist/electron.exe', ['.', '--remote-debugging-port=9339'], { stdio: 'ignore', cwd: process.cwd() })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let ws
try {
  let page
  for (let i = 0; i < 60; i++) { try { const l = await (await fetch('http://127.0.0.1:9339/json')).json(); page = l.find((p) => p.type === 'page' && p.url.includes('index.html')); if (page) break } catch {} await sleep(500) }
  ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j })
  let id = 0; const pend = new Map(); ws.onmessage = (e) => { const m = JSON.parse(e.data); pend.get(m.id)?.(m); pend.delete(m.id) }
  const send = (m, p) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })) })
  const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true })).result?.result?.value
  await sleep(2500)
  for (const [tab, file] of [[4, 'access2.png'], [2, 'analysis2.png']]) {
    await ev(`document.querySelector('.tab:nth-child(${tab})')?.click()`)
    await sleep(1500)
    const r = await send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(`test/shots/${file}`, Buffer.from(r.result.data, 'base64'))
    console.log('shot', file)
  }
} finally { ws?.close(); child.kill() }
