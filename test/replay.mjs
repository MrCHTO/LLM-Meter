/** 把抓到的请求体原样重放若干次到上游，观察缓存。用法：node test/replay.mjs <file> <baseUrl> <key> <times> */
import { readFileSync } from 'node:fs'

const [file, base, key, times = '3'] = process.argv.slice(2)
const body = readFileSync(file, 'utf8')

for (let i = 0; i < Number(times); i++) {
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body
  })
  const text = await res.text()
  let usage = null
  for (const part of text.split('\n\n')) {
    for (const line of part.split('\n')) {
      const t = line.trim()
      if (!t.startsWith('data:')) continue
      const payload = t.slice(5).trim()
      if (!payload || payload === '[DONE]') continue
      try {
        const json = JSON.parse(payload)
        if (json.usage) usage = json.usage
      } catch {
        /* 忽略 */
      }
    }
  }
  console.log(`#${i + 1} status=${res.status} cached=${usage?.prompt_tokens_details?.cached_tokens ?? 'null'} prompt=${usage?.prompt_tokens}`)
  await new Promise((r) => setTimeout(r, Number(process.env.GAP ?? 800)))
}
