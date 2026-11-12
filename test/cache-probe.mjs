/**
 * 判断是不是某个请求头把上游缓存打散了。
 * 用法：node test/cache-probe.mjs <baseUrl> <key> <model> <变体名>
 * 变体：plain | identity | full
 */
const [base, key, model, variant = 'plain'] = process.argv.slice(2)
const maxTokens = Number(process.env.MAX ?? 40)
const noMark = process.env.NO_MARK === '1'
const ask = process.env.ASK ?? '写一句话。'
const marker = noMark ? '' : `variant:${variant}:${Date.now()} `

const filler = '缓存前缀用于测量命中。The quick brown fox jumps over the lazy dog. 温度、气压与湿度沿着海岸线缓慢变化，'
const prefix = Array.from({ length: Number(process.env.LEN ?? 260) }, (_, i) => `${i} ${filler}`).join(' ')
const mark = `variant:${variant}:${Date.now()}`

async function once(label) {
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${key}` }
  if (variant === 'identity' || variant === 'full') headers['accept-encoding'] = 'identity'
  if (variant === 'full') {
    headers.accept = '*/*'
    headers['user-agent'] = 'LLM-Meter/0.1'
    headers.connection = 'keep-alive'
  }
  const payload = {
    model,
    stream: true,
    stream_options: { include_usage: true },
    max_tokens: maxTokens,
    temperature: 0,
    messages: [
      { role: 'system', content: `${marker}${prefix}` },
      { role: 'user', content: ask }
    ]
  }
  if (process.env.ORDER === 'last') {
    // 模拟代理注入后的键序：stream_options 落在最后
    const opts = payload.stream_options
    delete payload.stream_options
    payload.stream_options = opts
  }
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload)
  })
  let usage = null
  const dec = new TextDecoder()
  let buf = ''
  for await (const chunk of res.body) {
    buf += dec.decode(chunk, { stream: true })
  }
  for (const part of buf.split('\n\n')) {
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
  console.log(`${label}: cached=${usage?.prompt_tokens_details?.cached_tokens ?? 'null'} prompt=${usage?.prompt_tokens}`)
}

await once(`${variant}-1`)
await new Promise((r) => setTimeout(r, Number(process.env.GAP ?? 0)))
await once(`${variant}-2`)
