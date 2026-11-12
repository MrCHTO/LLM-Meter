/**
 * 直连真实上游，观察它到底回什么 usage 字段（用于核对缓存是否被中转保留）。
 * 用法：node test/real-check.mjs <baseUrl> <key> <model>
 */
const [base, key, model] = process.argv.slice(2)
if (!base || !key || !model) {
  console.error('usage: node test/real-check.mjs <baseUrl> <key> <model>')
  process.exit(2)
}

const filler = '缓存前缀用于测量命中。The quick brown fox jumps over the lazy dog. 温度、气压与湿度沿着海岸线缓慢变化，'
const prefix = Array.from({ length: 260 }, (_, i) => `${i} ${filler}`).join(' ')

async function once(label) {
  const started = Date.now()
  const res = await fetch(`${base.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      stream: true,
      stream_options: { include_usage: true },
      max_tokens: 160,
      temperature: 0,
      messages: [
        { role: 'system', content: prefix },
        { role: 'user', content: '用中文写一段约 150 字的说明。' }
      ]
    })
  })
  console.log(`\n[${label}] status=${res.status} ct=${res.headers.get('content-type')}`)
  if (!res.ok) {
    console.log((await res.text()).slice(0, 400))
    return
  }
  let text = ''
  let usage = null
  let frames = 0
  let firstMs = null
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split('\n\n')
    buffer = parts.pop() ?? ''
    for (const part of parts) {
      frames++
      for (const line of part.split('\n')) {
        const t = line.trimStart()
        if (!t.startsWith('data:')) continue
        const payload = t.slice(5).trim()
        if (!payload || payload === '[DONE]') continue
        try {
          const json = JSON.parse(payload)
          const delta = json.choices?.[0]?.delta?.content
          if (typeof delta === 'string' && delta) {
            text += delta
            if (firstMs === null) firstMs = Date.now() - started
          }
          if (json.usage) usage = json.usage
        } catch {
          /* 忽略非 JSON 帧 */
        }
      }
    }
  }
  const total = Date.now() - started
  console.log(`frames=${frames} first=${firstMs}ms total=${total}ms chars=${text.length}`)
  console.log('usage=', JSON.stringify(usage))
  console.log('text head=', text.slice(0, 60).replace(/\n/g, ' '))
}

await once('cold')
await new Promise((r) => setTimeout(r, 1500))
await once('warm')
