/** 造 15 秒流量后截仪表盘（验证柱状波形观感）。 */
import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const EXE = process.env.LOCALAPPDATA + '/Programs/LLM Meter/LLM Meter.exe'
const cfg = JSON.parse(readFileSync(process.env.APPDATA + '/llm-meter/data/config.json', 'utf8'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const child = spawn(process.cwd() + '/node_modules/electron/dist/electron.exe', ['.', '--remote-debugging-port=9335'], { stdio: 'ignore', cwd: process.cwd() })
let ws
try {
  let page
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:9335/json')).json()
      page = list.find((p) => p.type === 'page' && p.url.includes('index.html'))
      if (page) break
    } catch {}
    await sleep(500)
  }
  ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j })
  let id = 0
  const pending = new Map()
  ws.onmessage = (e) => { const m = JSON.parse(e.data); pending.get(m.id)?.(m); pending.delete(m.id) }
  const send = (method, params) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })) })
  const shot = async (file) => {
    const r = await send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(new URL(`../test/shots/${file}`, import.meta.url), Buffer.from(r.result.data, 'base64'))
  }

  // 15 秒内不规则地打请求，造不同高低
  const models = ['DeepSeek-V4.1-Flash-1017', 'GLM-5.3-Flash']
  const pattern = [1, 2, 1, 3, 2, 1, 1, 2, 3, 1, 2, 1, 1, 2, 3]
  for (const n of pattern) {
    for (let k = 0; k < n; k++) {
      fetch(`http://127.0.0.1:${cfg.settings.port}/v1/chat/completions`, {
        method: 'POST',
        headers: { authorization: `Bearer ${cfg.settings.localToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model: models[k % 2], messages: [{ role: 'user', content: 'say hi' }], max_tokens: 2 })
      }).catch(() => {})
    }
    await sleep(1000)
  }
  await sleep(800)
  await shot('wave.png')
  console.log('shot wave.png')
} finally {
  ws?.close()
  child.kill()
}
