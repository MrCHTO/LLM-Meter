import { readFileSync, writeFileSync } from 'node:fs'

const filler = '缓存前缀用于测量命中。The quick brown fox jumps over the lazy dog. 温度、气压与湿度沿着海岸线缓慢变化，'
const prefix = Array.from({ length: 260 }, (_, i) => `${i} ${filler}`).join(' ')

const body = {
  model: 'DeepSeek-V4.1-Flash',
  stream: true,
  stream_options: { include_usage: true },
  max_tokens: 120,
  temperature: 0,
  messages: [
    { role: 'system', content: prefix },
    { role: 'user', content: '写一句话。' }
  ]
}

const a = JSON.stringify(body)
const b = readFileSync(process.env.TEMP + '/b2.json', 'utf8')
console.log('same?', a === b, 'lenA', a.length, 'lenB', b.length)
if (a !== b) {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) {
      console.log('first diff at', i)
      console.log('A:', JSON.stringify(a.slice(Math.max(0, i - 40), i + 40)))
      console.log('B:', JSON.stringify(b.slice(Math.max(0, i - 40), i + 40)))
      break
    }
  }
}
writeFileSync(process.env.TEMP + '/b3.json', a)
