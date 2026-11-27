import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { probeBody } from '../src/main/probe/runner'

let root = ''

vi.mock('electron', () => ({
  app: { getPath: () => root },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (v: string) => Buffer.from(v),
    decryptString: (b: Buffer) => b.toString()
  }
}))

function seed(): void {
  const dir = join(root, 'data')
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'config.json'),
    JSON.stringify({
      version: 1,
      providers: [
        {
          id: 'p1',
          name: 'p',
          baseUrl: 'https://up.test/v1',
          format: 'openai',
          keyCipher: `raw:${Buffer.from('sk-good').toString('base64')}`,
          enabled: true,
          createdAt: 1
        }
      ],
      models: [{ id: 'm1', providerId: 'p1', upstreamModel: 'kimi-k3', alias: 'kimi-k3', enabled: true, watch: true }],
      settings: { port: 8787, pauseProbe: false }
    }),
    'utf8'
  )
}

const sse = (): string =>
  [
    'data: {"choices":[{"delta":{"content":"你好"}}]}',
    'data: {"choices":[{"delta":{"content":"世界"},"finish_reason":"stop"}]}',
    'data: {"choices":[],"usage":{"prompt_tokens":100,"completion_tokens":20}}',
    ''
  ].join('\n\n')

async function load(): Promise<typeof import('../src/main/probe/runner')> {
  vi.resetModules()
  return import('../src/main/probe/runner')
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'llmmeter-probe-'))
  seed()
})

afterEach(() => {
  vi.unstubAllGlobals()
  rmSync(root, { recursive: true, force: true })
})

describe('测速请求体', () => {
  it('不发 temperature，避免只接受固定值的模型 400', () => {
    const body = probeBody()
    expect(body.temperature).toBeUndefined()
    expect(body.stream).toBe(true)
    expect(body.stream_options).toEqual({ include_usage: true })
  })
})

describe('测速执行', () => {
  it('429 会退避重试并最终成功', async () => {
    const bodies: string[] = []
    let call = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: { body: string }) => {
        bodies.push(init.body)
        call++
        if (call === 1) {
          return new Response(JSON.stringify({ error: { message: 'inference exceeds tpm/rpm limit' } }), {
            status: 429,
            headers: { 'content-type': 'application/json' }
          })
        }
        return new Response(sse(), { status: 200, headers: { 'content-type': 'text/event-stream' } })
      })
    )
    const probe = await load()
    const out = await probe.run('m1')
    expect(call).toBe(2)
    expect(out.ok).toBe(true)
    expect(out.outputTokens).toBe(20)
    expect(bodies.every((b) => !b.includes('temperature'))).toBe(true)
  })

  it('429 三次仍失败时给出限流提示', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: { message: 'rate limited' } }), {
            status: 429,
            headers: { 'content-type': 'application/json' }
          })
      )
    )
    const probe = await load()
    const out = await probe.run('m1')
    expect(out.ok).toBe(false)
    expect(out.message).toContain('限流')
  }, 20_000)

  it('成功时算出首字与速率', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(sse(), { status: 200, headers: { 'content-type': 'text/event-stream' } }))
    )
    const probe = await load()
    const out = await probe.run('m1')
    expect(out.ok).toBe(true)
    expect(typeof out.ttftMs).toBe('number')
    expect(out.tps).toBeGreaterThan(0)
  })
})
