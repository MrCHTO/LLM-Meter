import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
const child = spawn(process.cwd() + '/node_modules/electron/dist/electron.exe', ['.', '--remote-debugging-port=9338', `--user-data-dir=${process.env.APPDATA}/llm-meter`], { stdio: 'ignore', cwd: process.cwd() })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let ws
try {
  let page
  for (let i = 0; i < 60; i++) { try { const l = await (await fetch('http://127.0.0.1:9338/json')).json(); page = l.find((p) => p.type === 'page' && p.url.includes('index.html')); if (page) break } catch {} await sleep(500) }
  ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j })
  let id = 0; const pend = new Map(); ws.onmessage = (e) => { const m = JSON.parse(e.data); pend.get(m.id)?.(m); pend.delete(m.id) }
  const ev = async (x) => (await new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression: x, returnByValue: true } })) })).result?.result?.value
  await sleep(2500)
  await ev("(() => { const sel = document.querySelector('.range-select'); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(sel, '3h'); sel.dispatchEvent(new Event('change', { bubbles: true })); return true })()")
  await sleep(3000)
  console.log('rangeRows 渲染检查: rows=', await ev("document.querySelectorAll('tbody tr.clickable').length"), 'body crashed?', (await ev("document.querySelector('.content')?.innerText.length ?? 0")) > 0)
  console.log('首行数值:', JSON.stringify(await ev("[...document.querySelectorAll('tbody tr.clickable')].map(r=>[...r.children].slice(2,8).map(c=>c.innerText).join('|'))")))
} finally { ws?.close(); child.kill() }
