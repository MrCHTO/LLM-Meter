import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createServer, type Server } from 'node:http'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = mkdtempSync(join(tmpdir(), 'llm-server-'))
const DATA = join(ROOT, 'data')
const PORT = 19200 + Math.floor(Math.random() * 300)
const UPSTREAM_PORT = PORT + 400
const TOKEN = 'deadbeefdeadbeefdeadbeefdeadbeef'

vi.mock('electron', () => ({ app: { getPath: () => ROOT, isPackaged: false } }))

let upstream: Server
let proxy: typeof import('../src/main/proxy/server')
let db: typeof import('../src/main/store/db')

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

function call(path: string, token = TOKEN): Promise<Response> {
  return fetch(`http://127.0.0.1:${PORT}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ model: 'known', stream: false, messages: [{ role: 'user', content: 'hi' }] })
  })
}

beforeAll(async () => {
  mkdirSync(DATA, { recursive: true })
  writeFileSync(
    join(DATA, 'config.json'),
    JSON.stringify({
      version: 1,
      providers: [
        {
          id: 'p1',
          name: '上游',
          baseUrl: `http://127.0.0.1:${UPSTREAM_PORT}`,
          format: 'openai',
          keyCipher: `raw:${Buffer.from('sk-up').toString('base64')}`,
          enabled: true,
          createdAt: 1
        }
      ],
      models: [
        {
          id: 'm1',
          providerId: 'p1',
          upstreamModel: 'up-model',
          alias: 'known',
          enabled: true,
          watch: true,
          priceIn: 1,
          priceOut: 2,
          priceCacheRead: 0,
          priceCacheInput: 0,
          currency: 'CNY',
          priceSource: 'manual',
          autoProbe: false,
          sort: 0,
          createdAt: 1
        }
      ],
      settings: { port: PORT, localToken: TOKEN, tokens: [{ id: 't1', remark: '默认', token: TOKEN, createdAt: 1 }] }
    }),
    'utf8'
  )

  upstream = createServer((req, res) => {
    if (req.url?.startsWith('/v1/models')) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ data: [{ id: 'up-model' }] }))
      return
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(
      JSON.stringify({
        choices: [{ message: { content: 'ok' } }],
        usage: { prompt_tokens: 100, completion_tokens: 5 }
      })
    )
  })
  await new Promise<void>((r) => upstream.listen(UPSTREAM_PORT, '127.0.0.1', () => r()))

  const cfg = await import('../src/main/store/config')
  cfg.get()
  db = await import('../src/main/store/db')
  db.init()
  proxy = await import('../src/main/proxy/server')
  await proxy.start(PORT)
})

afterAll(async () => {
  await proxy.stop()
  db.close()
  await new Promise<void>((r) => upstream.close(() => r()))
  for (let i = 0; i < 5; i++) {
    try {
      rmSync(ROOT, { recursive: true, force: true })
      break
    } catch {
      await sleep(200)
    }
  }
})

describe('代理入口', () => {
  it('缺 token 返回 401', async () => {
    const res = await call('/openai/v1/chat/completions', '')
    expect(res.status).toBe(401)
  })

  it('未知模型返回 404', async () => {
    const res = await fetch(`http://127.0.0.1:${PORT}/openai/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ model: 'nope', messages: [] })
    })
    expect(res.status).toBe(404)
  })

  it('成功转发并原样带回上游内容', async () => {
    const res = await call('/openai/v1/chat/completions')
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('ok')
  })

  it('usage 与成本落进明细', async () => {
    await sleep(300)
    const row = db
      .get()
      .get<{ input_tokens: number; output_tokens: number; cost: number; token_remark: string }>(
        'select input_tokens, output_tokens, cost, token_remark from requests order by ts desc limit 1'
      )
    expect(row?.input_tokens).toBe(100)
    expect(row?.output_tokens).toBe(5)
    expect(row?.cost).toBeCloseTo((100 * 1 + 5 * 2) / 1e6)
    expect(row?.token_remark).toBe('默认')
  })

  it('端口被占用时顺延到下一个', async () => {
    await proxy.stop()
    const blocker = createServer((_q, r) => r.end())
    await new Promise<void>((r) => blocker.listen(PORT, '127.0.0.1', () => r()))
    try {
      const state = await proxy.start(PORT)
      expect(state.running).toBe(true)
      expect(state.port).toBeGreaterThanOrEqual(PORT + 1)
    } finally {
      await new Promise<void>((r) => blocker.close(() => r()))
    }
  })
})
