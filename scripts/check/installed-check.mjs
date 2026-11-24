/** 一次性的安装版验证：真实档案上跑旧数据导入并截图主窗。 */
import { spawn } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const EXE =
  process.env.LLM_METER_EXE ??
  process.env.PROGRAMFILES + '/llm meter/LLM Meter.exe'
/** 安装版数据在安装目录下 */
const DATA = join(dirname(EXE), 'data')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const PORT = JSON.parse(readFileSync(join(DATA, 'config.json'), 'utf8')).settings.port

const evDir = join(DATA, 'events')
const srcLines = existsSync(evDir)
  ? readdirSync(evDir)
      .filter((n) => n.endsWith('.jsonl'))
      .reduce((n, f) => n + readFileSync(join(evDir, f), 'utf8').split('\n').filter((l) => l.trim()).length, 0)
  : -1

const child = spawn(EXE, ['--remote-debugging-port=9333'], { stdio: ['ignore', 'pipe', 'pipe'] })
const log = []
child.stdout.on('data', (d) => log.push(d.toString()))
child.stderr.on('data', (d) => log.push(d.toString()))

function rows() {
  const file = join(DATA, 'llm-meter.db')
  if (!existsSync(file)) return -1
  const { DatabaseSync } = require('node:sqlite')
  const conn = new DatabaseSync(file, { readOnly: true })
  try {
    return conn.prepare('select count(*) c from requests').get().c
  } catch {
    return -1
  } finally {
    conn.close()
  }
}

const until = Date.now() + 30_000
while (Date.now() < until && rows() < 0) await sleep(400)

const results = []
const check = (n, p, d = '') => {
  results.push(p)
  console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${d ? ` — ${d}` : ''}`)
}
const expected = srcLines >= 0 ? srcLines : rows()
check('真实明细已导入', rows() === expected, `${rows()} vs ${expected} 行`)
check('旧目录已留底', existsSync(join(DATA, 'legacy-imported')) && !existsSync(join(DATA, 'events')))
check('代理已监听', await (async () => {
  for (let i = 0; i < 20; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/healthz`)
      if (res.ok) return true
    } catch {
      /* 等 */
    }
    await sleep(400)
  }
  return false
})())

// 截图
try {
  await sleep(1200)
  const list = await (await fetch('http://127.0.0.1:9333/json')).json()
  const page = list.find((p) => p.type === 'page' && p.url.includes('index.html'))
  if (page) {
    const ws = new WebSocket(page.webSocketDebuggerUrl)
    await new Promise((r, j) => {
      ws.onopen = r
      ws.onerror = j
    })
    ws.send(JSON.stringify({ id: 0, method: 'Runtime.enable' }))
    // 等界面真的渲染出来再截
    for (let i = 0; i < 40; i++) {
      ws.send(
        JSON.stringify({
          id: 2,
          method: 'Runtime.evaluate',
          params: { expression: 'document.body.innerText.trim().length', returnByValue: true }
        })
      )
      const len = await new Promise((resolve) => {
        ws.onmessage = (e) => {
          const msg = JSON.parse(e.data)
          if (msg.id === 2) resolve(msg.result?.result?.value ?? 0)
        }
      })
      if (Number(len) > 120) break
      await sleep(400)
    }
    ws.send(JSON.stringify({ id: 1, method: 'Page.captureScreenshot', params: { format: 'png' } }))
    const shot = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('截图超时')), 10_000)
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data)
        if (msg.id === 1) {
          clearTimeout(timer)
          resolve(msg.result.data)
        }
      }
    })
    writeFileSync(join(process.cwd(), 'test', 'shots', 'installed.png'), Buffer.from(shot, 'base64'))
    check('主窗已截图', shot.length > 1000)

    ws.send(
      JSON.stringify({
        id: 6,
        method: 'Runtime.evaluate',
        params: { expression: "document.title", returnByValue: true }
      })
    )
    const brand = await new Promise((resolve) => {
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data)
        if (msg.id === 6) resolve(String(msg.result?.result?.value ?? ''))
      }
    })
    check('窗口标题带版本号', /\d+\.\d+\.\d+/.test(brand), brand)

    // 去分析页看历史导入的数据
    const clickedAnalysis = await (async () => {
      ws.send(
        JSON.stringify({
          id: 4,
          method: 'Runtime.evaluate',
          params: {
            expression:
              "(() => { const tabs = [...document.querySelectorAll('.tab')].map((x) => x.textContent.trim()); const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === '分析'); if (b) b.click(); return JSON.stringify({ tabs, hit: !!b }) })()",
            returnByValue: true
          }
        })
      )
      return new Promise((resolve) => {
        ws.onmessage = (e) => {
          const msg = JSON.parse(e.data)
          if (msg.id === 4) resolve(String(msg.result?.result?.value ?? ''))
        }
      })
    })()
    console.log('analysis click:', clickedAnalysis)
    const evalNow = (expression) =>
      new Promise((resolve) => {
        ws.send(JSON.stringify({ id: 9, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }))
        ws.onmessage = (e) => {
          const msg = JSON.parse(e.data)
          if (msg.id === 9) resolve(msg.result?.result?.value ?? 0)
        }
      })
    for (let i = 0; i < 30; i++) {
      if (await evalNow("document.querySelectorAll('.card select').length")) break
      await sleep(300)
    }
    // 刚过零点时「今天」可能还没有流量，切到近 24 小时再看
    await evalNow(
      "(() => { const sel = [...document.querySelectorAll('.card select')][0]; if (!sel) return 0; const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; setter.call(sel, '24h'); sel.dispatchEvent(new Event('change', { bubbles: true })); return 1 })()"
    )
    let bars = 0
    for (let i = 0; i < 24; i++) {
      bars = Number(await evalNow("document.querySelectorAll('rect.series-bar').length"))
      if (bars > 0) break
      await sleep(500)
    }
    check('分析页画出柱状图', bars > 0, `bars=${bars}`)
    ws.send(JSON.stringify({ id: 3, method: 'Page.captureScreenshot', params: { format: 'png' } }))
    const shot2 = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('分析页截图超时')), 10_000)
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data)
        if (msg.id === 3) {
          clearTimeout(timer)
          resolve(msg.result.data)
        }
      }
    })
    writeFileSync(join(process.cwd(), 'test', 'shots', 'installed-analysis.png'), Buffer.from(shot2, 'base64'))
    check('分析页已截图', shot2.length > 1000)
    ws.close()
  } else {
    check('主窗已截图', false, '找不到页面')
  }
} catch (err) {
  check('主窗已截图', false, err.message)
}

const crash = log.join('').match(/Uncaught|ERR_FILE_NOT_FOUND|Failed to load/g)
check('主进程无加载错误', !crash, crash ? String(crash) : '')

child.kill()
await sleep(900)
const failed = results.filter((p) => !p).length
console.log(`\n${results.length - failed}/${results.length} 通过`)
process.exit(failed ? 1 : 0)
