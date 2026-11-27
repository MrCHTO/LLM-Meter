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
    uncachedInputTokens: 10,
    outputTokens: tokens,
    cacheReadTokens: 0,
    cacheInputTokens: 0,
    cacheInputReported: false,
    cacheReadReported: false,
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

  it('请求量按请求开始秒落桶而非完成秒', async () => {
    const live = await load()
    const t0 = Math.floor(Date.now() / 1000) * 1000
    // 5 秒的请求在 t0+5s 完成：请求量应落在 t0 那一秒（倒数第 6 格），最后一格为空
    live.record({ ...ev(t0 + 5_000, 10), durationMs: 5_000 })
    const snap = live.snapshot(false, null, '', t0 + 5_000)
    const buckets = snap.totals.reqBuckets
    const len = buckets.length
    expect(buckets[len - 6]).toBe(1)
    expect(buckets[len - 1]).toBe(0)
    expect(buckets.reduce((a, b) => a + b, 0)).toBe(1)
  })

  it('超过窗口的事件丢弃', async () => {
    const live = await load()
    const now = 1_700_000_000_000
    live.replay([ev(now - 181_000, 999)], now)
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

describe('上一条速率', () => {
  it('成功请求记录生成速率，失败不覆盖', async () => {
    const live = await load()
    const t0 = 1_700_000_000_000
    live.record({ ...ev(t0, 100), ttftMs: 200, durationMs: 1000 })
    const first = live.snapshot(false, null, '', t0).models[0]
    expect(first?.lastTps).toBeCloseTo(125)
    expect(first?.lastTpsAt).toBe(t0)
    live.record({ ...ev(t0 + 1, 50, false), ttftMs: 300, durationMs: 900 })
    const after = live.snapshot(false, null, '', t0 + 1).models[0]
    expect(after?.lastTps).toBeCloseTo(125)
  })
})

describe('实时增量估算', () => {
  it('首字前无值，增量后按中英系数出值，结束后回到真实均值', async () => {
    vi.useFakeTimers()
    const t0 = 1_700_000_000_000
    vi.setSystemTime(t0)
    try {
      const live = await load()
      live.begin('m1')
      expect(live.snapshot(false, null, '', t0).models[0]?.realtimeTps).toBeNull()

      live.noteDelta('m1', 2, 0) // 中文 2 字符 / 1.7 ≈ 1.18 token，0.5s 窗口
      const mid = live.snapshot(false, null, '', t0 + 500).models[0]
      expect(mid?.realtimeTps).toBeCloseTo(2.35, 1)
      expect((mid?.deltaBuckets ?? []).reduce((a, b) => a + b, 0)).toBeCloseTo(1.18, 1)

      live.record({ ...ev(t0, 10), ttftMs: 100, durationMs: 1100 })
      live.end('m1')
      const done = live.snapshot(false, null, '', t0 + 1000).models[0]
      expect(done?.realtimeTps).toBeNull()
      expect(done?.lastTps).toBeCloseTo(10)
    } finally {
      vi.useRealTimers()
    }
  })

  it('超过 2 秒没有新增量时速率归零', async () => {
    vi.useFakeTimers()
    const t0 = 1_700_000_000_000
    vi.setSystemTime(t0)
    try {
      const live = await load()
      live.begin('m1')
      live.noteDelta('m1', 0, 8)
      expect(live.snapshot(false, null, '', t0 + 100).models[0]?.realtimeTps).toBeGreaterThan(0)
      expect(live.snapshot(false, null, '', t0 + 3000).models[0]?.realtimeTps).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('真实 usage 会校正系数，同样字符估出更多 token', async () => {
    vi.useFakeTimers()
    const t0 = 1_700_000_000_000
    vi.setSystemTime(t0)
    try {
      const live = await load()
      live.begin('m1')
      live.noteDelta('m1', 0, 4)
      const before = live.snapshot(false, null, '', t0 + 500).models[0]?.deltaBuckets.reduce((a, b) => a + b, 0) ?? 0
      // 上游实际给了 20 token，远高于默认系数估算的 1.05
      live.record({ ...ev(t0, 20), ttftMs: 100, durationMs: 600 })
      live.end('m1')
      live.begin('m1')
      live.noteDelta('m1', 0, 4)
      const after = live.snapshot(false, null, '', t0 + 1000).models[0]?.deltaBuckets.reduce((a, b) => a + b, 0) ?? 0
      expect(after).toBeGreaterThan(before)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('TTFT 分位样本', () => {
  it('探针样本不进分位数', async () => {
    const live = await load()
    const t0 = 1_700_000_000_000
    live.record({ ...ev(t0, 10), ttftMs: 100 })
    live.record({ ...ev(t0 + 1, 10), ttftMs: 200 })
    live.record({ ...ev(t0 + 2, 10), ttftMs: 9999, source: 'probe' })
    const m = live.snapshot(false, null, '', t0 + 3).models[0]
    expect(m?.ttftP50).toBe(100)
    expect(m?.ttftP99).toBe(200)
  })
})
