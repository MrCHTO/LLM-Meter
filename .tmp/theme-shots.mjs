/** 深/浅两主题主窗截图（临时调试端口实例）。 */
import { spawn } from 'node:child_process'
const EXE = process.env.LOCALAPPDATA + '/Programs/LLM Meter/LLM Meter.exe'
const child = spawn(EXE, ['--remote-debugging-port=9334'], { stdio: 'ignore' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let ws
try {
  let page
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:9334/json')).json()
      page = list.find((p) => p.type === 'page' && p.url.includes('index.html'))
      if (page) break
    } catch {}
    await sleep(500)
  }
  ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j })
  ws.send(JSON.stringify({ id: 0, method: 'Runtime.enable' }))
  const pending = new Map(); let id = 0
  ws.onmessage = (e) => { const m = JSON.parse(e.data); pending.get(m.id)?.(m); pending.delete(m.id) }
  const send = (method, params) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })) })
  const evalJs = async (expr, awaitPromise = false) => (await send('Runtime.evaluate', { expression: expr, awaitPromise, returnByValue: true })).result?.result?.value
  const shot = async (file) => {
    const r = await send('Page.captureScreenshot', { format: 'png' })
    const { writeFileSync } = await import('node:fs')
    writeFileSync(new URL(`../test/shots/${file}`, import.meta.url), Buffer.from(r.result.data, 'base64'))
  }
  await sleep(2500)
  for (const theme of ['dark', 'light']) {
    await evalJs(`(async()=>await window.api.updateSettings({theme:'${theme}'}))()`, true)
    await evalJs('location.reload()')
    await sleep(2500)
    await shot(`theme-${theme}.png`)
    console.log('shot', theme)
  }
  await evalJs("(async()=>await window.api.updateSettings({theme:'system'}))()", true)
  await evalJs('location.reload()')
  await sleep(1500)
} finally {
  ws?.close()
  child.kill()
}
