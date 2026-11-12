/**
 * 假上游：只为实现端到端核对，不追求拟真。
 * 用法：node test/fake-upstream.mjs [port]
 */
import { createServer } from 'node:http'

const port = Number(process.argv[2] ?? 18999)
const seenPrefixes = new Set()

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function sse(res, frames, gap = 25) {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive'
  })
  return (async () => {
    for (const frame of frames) {
      res.write(frame)
      await sleep(gap)
    }
    res.end()
  })()
}

function readJson(req) {
  return new Promise((resolve) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        resolve({})
      }
    })
  })
}

const OPENAI_FRAMES = (cached) => {
  const out = []
  out.push(`data: ${JSON.stringify({ id: 'x', choices: [{ delta: { role: 'assistant' } }] })}\n\n`)
  for (const word of ['你好', '，', '这是', '测试', '输出', '。']) {
    out.push(`data: ${JSON.stringify({ id: 'x', choices: [{ delta: { content: word } }] })}\n\n`)
  }
  out.push(
    `data: ${JSON.stringify({
      id: 'x',
      choices: [],
      usage: {
        prompt_tokens: 1200,
        completion_tokens: 42,
        total_tokens: 1242,
        prompt_tokens_details: { cached_tokens: cached }
      }
    })}\n\n`
  )
  out.push('data: [DONE]\n\n')
  return out
}

const ANTHROPIC_FRAMES = (cached) => [
  `event: message_start\ndata: ${JSON.stringify({
    type: 'message_start',
    message: {
      id: 'msg',
      usage: {
        input_tokens: 120,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: cached,
        output_tokens: 1
      }
    }
  })}\n\n`,
  `event: content_block_start\ndata: ${JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })}\n\n`,
  `event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '你好' } })}\n\n`,
  `event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '世界' } })}\n\n`,
  `event: message_delta\ndata: ${JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 33 } })}\n\n`,
  `event: message_stop\ndata: ${JSON.stringify({ type: 'message_stop' })}\n\n`
]

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`)
  const auth = req.headers.authorization ?? ''
  const key = req.headers['x-api-key'] ?? ''
  const realKey = key || auth.replace(/^Bearer\s+/i, '')

  if (url.pathname === '/v1/models') {
    if (realKey !== 'sk-good') {
      res.writeHead(401, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { message: 'bad key' } }))
      return
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ data: [{ id: 'gpt-4o-mini' }, { id: 'claude-sonnet-4-5' }] }))
    return
  }

  const body = await readJson(req)
  if (realKey !== 'sk-good') {
    res.writeHead(401, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: { message: 'bad key' } }))
    return
  }

  const marker = String(body.model ?? '')
  const cached = seenPrefixes.has(marker) ? 1080 : 0
  seenPrefixes.add(marker)

  if (url.pathname === '/v1/chat/completions') {
    if (body.model === 'slow-model') await sleep(800)
    if (body.stream === false) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify({
          id: 'x',
          choices: [{ message: { role: 'assistant', content: '非流式回答' } }],
          usage: { prompt_tokens: 900, completion_tokens: 12, prompt_tokens_details: { cached_tokens: 500 } }
        })
      )
      return
    }
    await sse(res, OPENAI_FRAMES(cached))
    return
  }

  if (url.pathname === '/v1/messages') {
    await sse(res, ANTHROPIC_FRAMES(cached))
    return
  }

  if (url.pathname === '/v1/boom') {
    res.writeHead(500, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: { message: 'boom' } }))
    return
  }

  res.writeHead(404)
  res.end('not found')
})

server.listen(port, '127.0.0.1', () => console.log(`fake upstream on ${port}`))
