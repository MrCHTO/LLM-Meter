import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
const child = spawn(process.cwd() + '/node_modules/electron/dist/electron.exe', ['.', '--remote-debugging-port=9337', `--user-data-dir=${mkdtempSync(tmpdir() + '/st-')}`], { stdio: 'ignore', cwd: process.cwd() })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let ws
try {
  let page
  for (let i = 0; i < 60; i++) { try { const l = await (await fetch('http://127.0.0.1:9337/json')).json(); page = l.find((p) => p.type === 'page' && p.url.includes('index.html')); if (page) break } catch {} await sleep(500) }
  ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j })
  let id = 0; const pend = new Map(); ws.onmessage = (e) => { const m = JSON.parse(e.data); pend.get(m.id)?.(m); pend.delete(m.id) }
  const ev = async (x, a = false) => (await new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression: x, awaitPromise: a, returnByValue: true } })) })).result
  await sleep(2500)
  await ev("document.querySelector('.tab:nth-child(3)').click()")
  await sleep(1200)
  console.log('state count:', JSON.stringify(await ev("document.querySelectorAll('.state').length")))
  console.log('state pillbtn:', JSON.stringify(await ev("document.querySelectorAll('.state.pill, .state.btn').length")))
  console.log('models tbody html sample:', JSON.stringify((await ev("document.querySelector('.tbl-models tbody tr')?.innerHTML ?? ''", false)).result?.value?.slice(0, 600)))
  console.log('th 状态:', JSON.stringify(await ev("[...document.querySelectorAll('.tbl-models thead th')].map(h=>h.innerText)")))
} finally { ws?.close(); child.kill() }
