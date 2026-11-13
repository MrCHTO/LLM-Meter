import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let root = ''

vi.mock('electron', () => ({
  app: { getPath: () => root }
}))

/** snapshot 只遍历配置里的模型，先塞一个 m1 进去 */
function seedModel(): void {
  const dir = join(root, 'data')
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'config.json'),
    JSON.stringify({
      version: 1,
      providers: [{ id: 'p1', name: 'p', baseUrl: 'https://x.test', format: 'openai', keyCipher: '', createdAt: 1 }],
      models: [{ id: 'm1', providerId: 'p1', upstreamModel: 'u', alias: 'a', enabled: true, watch: true }],
      settings: { port: 8787 }
    }),
    'utf8'
  )
}

async function load(): Promise<typeof import('../src/main/store/live')> {
  vi.resetModules()
  return import('../src/main/store/live')
}

function ev(ts: number, tokens: number, ok = true): Parameters<Awaited<ReturnType<typeof load>>['record']>[0] {
  return {
    id: `e-${ts}-${tokens}`,
    ts,
    source: 'proxy',
    modelId: 'm1',
    alias: 'a',
    providerId: 'p1',
    status: ok ? 200 : 500,
    ok,
    errorKind: ok ? null : 'upstream_5xx',
    stream: true,
    ttftMs: null,
    durationMs: 1000,
    inputTokens: 10,
    outputTokens: tokens,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    cost: 0,
    currency: 'CNY'
  }
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'llmmeter-live-'))
  seedModel()
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('启动回放', () => {
  it('事件按自己的时间落到对应秒桶，不会堆成假尖峰', async () => {
    const live = await load()
    const now = 1_700_000_000_000
    // 30 秒前 100 token、10 秒前 300 token、当前这一秒 200 token
    live.replay([ev(now - 30_000, 100), ev(now - 10_000, 300), ev(now, 200)], now)

    const snap = live.snapshot(false, null, '', now)
    const buckets = snap.totals.buckets

    expect(buckets[buckets.length - 1]).toBe(200)
    expect(buckets[buckets.length - 11]).toBe(300)
    expect(buckets[buckets.length - 31]).toBe(100)
    expect(buckets.reduce((a, b) => a + b, 0)).toBe(600)
    expect(buckets.filter((b) => b > 0).length).toBe(3)
  })

  it('超过 60 秒的事件丢弃', async () => {
    const live = await load()
    const now = 1_700_000_000_000
    live.replay([ev(now - 61_000, 999)], now)
    const snap = live.snapshot(false, null, '', now)
    expect(snap.totals.buckets.reduce((a, b) => a + b, 0)).toBe(0)
  })

  it('失败事件只计请求不计 token', async () => {
    const live = await load()
    const now = 1_700_000_000_000
    live.replay([ev(now - 5_000, 0, false)], now)
    const snap = live.snapshot(false, null, '', now)
    expect(snap.totals.buckets.reduce((a, b) => a + b, 0)).toBe(0)
    expect(snap.totals.reqBuckets.reduce((a, b) => a + b, 0)).toBe(1)
  })

  it('未来时间戳不会越界', async () => {
    const live = await load()
    const now = 1_700_000_000_000
    live.replay([ev(now + 3_000, 50)], now)
    const snap = live.snapshot(false, null, '', now)
    expect(snap.totals.buckets.reduce((a, b) => a + b, 0)).toBe(0)
  })
})

describe('流光可见性', () => {
  it('请求开始至少亮 1.5 秒，结束当拍即可灭', async () => {
    const live = await load()
    const t0 = 1_700_000_000_000
    const spy = vi.spyOn(Date, 'now').mockReturnValue(t0)

    live.begin('m1')
    expect(live.snapshot(false, null, '', t0).models[0]?.active).toBe(true)

    live.end('m1')
    // 结束后 0.5 秒仍因最短可见时长保持
    expect(live.snapshot(false, null, '', t0 + 500).models[0]?.active).toBe(true)
    // 1.6 秒后熄灭，不再有额外的 3 秒
    expect(live.snapshot(false, null, '', t0 + 1_600).models[0]?.active).toBe(false)

    spy.mockRestore()
  })

  it('连续请求会续期，不会在间隙里闪灭', async () => {
    const live = await load()
    const t0 = 1_700_000_000_000
    const spy = vi.spyOn(Date, 'now').mockReturnValue(t0)

    live.begin('m1')
    live.end('m1')
    spy.mockReturnValue(t0 + 1_000)
    live.begin('m1')
    live.end('m1')
    // 第二个请求把可见期推到 t0+2.5s
    expect(live.snapshot(false, null, '', t0 + 2_400).models[0]?.active).toBe(true)
    expect(live.snapshot(false, null, '', t0 + 2_600).models[0]?.active).toBe(false)

    spy.mockRestore()
  })
})
