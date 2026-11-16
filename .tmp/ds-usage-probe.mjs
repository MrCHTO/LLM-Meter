/** 极小 GLM 请求：经本地代理发出，dump 原始 usage，区分渠道剥离 vs 真报 0。 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const cfg = JSON.parse(readFileSync(process.env.APPDATA + '/llm-meter/data/config.json', 'utf8'))
const port = cfg.settings.port
const token = cfg.settings.localToken ?? ''

const body = {
  model: 'DeepSeek-V4.1-Flash-1017',
  messages: [{ role: 'user', content: 'hi' }],
  max_tokens: 5,
}

const res = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
  method: 'POST',
  headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  body: JSON.stringify(body),
})
const text = await res.text()
writeFileSync(join(import.meta.dirname, 'glm-usage.json'), text)
console.log('HTTP', res.status)
try {
  const u = JSON.parse(text)
  console.log('model:', u.model)
  console.log('usage 原文:', JSON.stringify(u.usage, null, 1))
  if (u.error) console.log('error:', JSON.stringify(u.error))
} catch {
  console.log('非 JSON:', text.slice(0, 300))
}
