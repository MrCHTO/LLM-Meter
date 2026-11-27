import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let root = ''

vi.mock('electron', () => ({
  app: { getPath: () => root }
}))

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

function ev(ts: number, tokens: number): Parameters<Awaited<ReturnType<typeof load>>['record']>[0] {
  return {
    id: `e-${ts}-${tokens}`,
    ts,
    source: 'proxy',
    modelId: 'm1',
    alias: 'a',
    providerId: 'p1',
    status: 200,
    ok: true,
    errorKind: null,
    stream: true,
    ttftMs: 300,
    durationMs: 1000,
    inputTokens: tokens,
    uncachedInputTokens: tokens,
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
  root = mkdtempSync(join(tmpdir(), 'llmmeter-day-'))
  seedModel()
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('跨日', () => {
  it('过 0 点后今日合计归零，TTFT 样本不混入前一天', async () => {
    vi.useFakeTimers()
    const before = new Date(2026, 10, 20, 23, 59, 0).getTime()
    vi.setSystemTime(before)
    try {
      const live = await load()
      const db = await import('../src/main/store/db')
      db.init()
      live.init()
      live.record(ev(before, 100))
      expect(live.snapshot(false, null, '', before).models[0]?.today.requests).toBe(1)

      const after = before + 2 * 60_000
      const snap = live.snapshot(false, null, '', after)
      expect(snap.models[0]?.today.requests).toBe(0)
      expect(snap.models[0]?.today.output).toBe(0)
      expect(snap.models[0]?.ttftP50).toBeNull()

      live.record(ev(after, 50))
      const next = live.snapshot(false, null, '', after).models[0]
      expect(next?.today.requests).toBe(1)
      expect(next?.today.output).toBe(50)
      expect(next?.ttftP50).toBe(300)
    } finally {
      ;(await import('../src/main/store/db')).close()
      vi.useRealTimers()
    }
  })
})
