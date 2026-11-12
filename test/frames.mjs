const [base, key, model] = process.argv.slice(2)

const res = await fetch(`${base}/chat/completions`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
  body: JSON.stringify({
    model,
    stream: true,
    max_tokens: 60,
    messages: [{ role: 'user', content: '写一句话介绍北京' }]
  })
})
console.log('status', res.status, res.headers.get('content-type'))
const reader = res.body.getReader()
const decoder = new TextDecoder()
let buf = ''
let n = 0
for (;;) {
  const { done, value } = await reader.read()
  if (done) break
  buf += decoder.decode(value, { stream: true })
  const parts = buf.split('\n\n')
  buf = parts.pop() ?? ''
  for (const part of parts) {
    for (const line of part.split('\n')) {
      const t = line.trim()
      if (!t.startsWith('data:')) continue
      const payload = t.slice(5).trim()
      if (!payload || payload === '[DONE]') continue
      n += 1
      if (n <= 8) console.log(n, payload.slice(0, 300))
    }
  }
}
console.log('total data frames', n)
