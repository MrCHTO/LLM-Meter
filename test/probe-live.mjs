/**
 * 用用户真实配置对指定别名逐个测速，验证修复是否生效。
 * 用法：node test/probe-live.mjs kimi-k3 glm-5.3
 */
import { spawn } from 'node:child_process'
import { join } from 'node:path'

const aliases = process.argv.slice(2)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const exe = join(process.env.LOCALAPPDATA ?? '', 'Programs', 'LLM Meter', 'LLM Meter.exe')

const child = spawn(exe, ['--remote-debugging-port=9777'], { stdio: 'ignore' })

async function main() {
  const page = await (async () => {
    for (let i = 0; i < 40; i++) {
      try {
        const list = await fetch('http://127.0.0.1:9777/json/list').then((r) => r.json())
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
    p.resolve(m.result)
  }
  const evaluate = async (expr) => {
    for (let i = 0; i < 5; i++) {
      try {
        const msgId = ++id
        const res = await new Promise((resolve) => {
          pending.set(msgId, { resolve })
          ws.send(
            JSON.stringify({
              id: msgId,
              method: 'Runtime.evaluate',
              params: { expression: expr, awaitPromise: true, returnByValue: true }
            })
          )
        })
        return res.result.value
      } catch {
        await sleep(600)
      }
    }
    return undefined
  }

  for (let i = 0; i < 40; i++) {
    if (await evaluate('typeof window.api === "object"')) break
    await sleep(500)
  }

  const models = await evaluate('(async()=>(await window.api.config()).data.models.map((m) => [m.alias, m.id]))()')
  console.log('配置中的模型:', models.map((m) => m[0]).join(', '))

  for (const alias of aliases) {
    const hit = models.find((m) => m[0] === alias || m[0].includes(alias))
    if (!hit) {
      console.log(`${alias}: 配置里没找到`)
      continue
    }
    const raw = await evaluate(`(async()=>JSON.stringify(await window.api.runProbe(${JSON.stringify(hit[1])})))()`)
    const out = JSON.parse(raw)
    console.log(`${alias}: ok=${out.data?.ok} status=${out.data?.status} message=${out.data?.message}`)
    await sleep(1500)
  }
  ws.close()
}

main()
  .catch((err) => console.log('FAIL', err.message))
  .finally(async () => {
    await sleep(400)
    child.kill()
  })
