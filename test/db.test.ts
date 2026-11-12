import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { RequestEvent } from '../src/shared/types'

let root = ''

vi.mock('electron', () => ({
  app: { getPath: () => root }
}))

async function load(): Promise<{
  driver: typeof import('../src/main/store/db/driver')
  repo: typeof import('../src/main/store/db/repo')
  schema: typeof import('../src/main/store/db/schema')
  importer: typeof import('../src/main/store/db/import')
}> {
  vi.resetModules()
  const driver = await import('../src/main/store/db/driver')
  const repo = await import('../src/main/store/db/repo')
  const schema = await import('../src/main/store/db/schema')
  const importer = await import('../src/main/store/db/import')
  return { driver, repo, schema, importer }
}

function ev(over: Partial<RequestEvent> = {}): RequestEvent {
  const ts = over.ts ?? Date.now()
  return {
    id: `e-${ts}-${Math.random().toString(36).slice(2, 8)}`,
    ts,
    source: 'proxy',
    modelId: 'm1',
    alias: 'alias-1',
    providerId: 'p1',
    status: 200,
    ok: true,
    errorKind: null,
    stream: true,
    ttftMs: 120,
    durationMs: 1000,
    inputTokens: 1000,
    outputTokens: 200,
    cacheReadTokens: 800,
    cacheWriteTokens: 0,
    cost: 0.002,
    currency: 'CNY',
    ...over
  }
}

const extra = { day: '2026-11-12', providerName: '供应商', baseUrl: 'https://x.test', upstreamModel: 'up-1' }

let db: Awaited<ReturnType<typeof openDb>> | null = null

async function openDb(): Promise<import('../src/main/store/db/driver').Db> {
  const { driver, schema } = await load()
  const file = join(root, 'test.db')
  const conn = driver.open(file)
  schema.ensureMeta(conn)
  schema.migrate(conn)
  return conn
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'llmmeter-db-'))
  db = await openDb()
})

afterEach(() => {
  db?.close()
  db = null
  rmSync(root, { recursive: true, force: true })
})

describe('写入', () => {
  it('一次写入同时落明细与两级聚合', async () => {
    const { repo } = await load()
    const conn = db as NonNullable<typeof db>
    repo.recordRequest(conn, ev(), extra)

    expect(conn.get<{ c: number }>('select count(*) c from requests')?.c).toBe(1)
    expect(conn.get<{ c: number }>('select count(*) c from rollup_minute')?.c).toBe(1)
    expect(conn.get<{ c: number }>('select count(*) c from rollup_day')?.c).toBe(1)
    const minute = conn.get<{ input: number; cache_read: number; requests: number }>(
      'select input, cache_read, requests from rollup_minute'
    )
    expect(minute).toEqual({ input: 1000, cache_read: 800, requests: 1 })
  })

  it('失败请求计入 errors 但 token 照记', async () => {
    const { repo } = await load()
    const conn = db as NonNullable<typeof db>
    repo.recordRequest(conn, ev({ ok: false, status: 500, errorKind: 'upstream_5xx', outputTokens: 0 }), extra)
    const row = conn.get<{ errors: number; requests: number; output: number }>(
      'select errors, requests, output from rollup_minute'
    )
    expect(row).toEqual({ errors: 1, requests: 1, output: 0 })
  })

  it('主键冲突时整条事务回滚', async () => {
    const { repo } = await load()
    const conn = db as NonNullable<typeof db>
    const one = ev()
    repo.recordRequest(conn, one, extra)
    expect(() => repo.recordRequest(conn, one, extra)).toThrow()
    expect(conn.get<{ c: number }>('select count(*) c from requests')?.c).toBe(1)
    // 聚合没被重复累加
    expect(conn.get<{ requests: number }>('select requests from rollup_minute')?.requests).toBe(1)
  })
})

describe('查询', () => {
  it('按 model 分组的时间序列只在有数据的桶上有值', async () => {
    const { repo } = await load()
    const conn = db as NonNullable<typeof db>
    const base = new Date('2026-11-12T10:00:00').getTime()
    repo.recordRequest(conn, ev({ ts: base, outputTokens: 100 }), extra)
    repo.recordRequest(conn, ev({ ts: base + 120_000, outputTokens: 300 }), extra)

    const out = repo.series(conn, {
      from: base - 60_000,
      to: base + 600_000,
      granularity: 'minute',
      metric: 'output',
      groupBy: 'model',
      source: 'proxy'
    })
    expect(out.buckets.length).toBe(2)
    expect(out.series[0]?.key).toBe('m1')
    expect(out.series[0]?.points).toEqual([100, 300])
  })

  it('按供应商分组把同一供应商的模型合并', async () => {
    const { repo } = await load()
    const conn = db as NonNullable<typeof db>
    const now = Date.now()
    repo.recordRequest(conn, ev({ ts: now, outputTokens: 10 }), extra)
    repo.recordRequest(conn, ev({ ts: now + 1, outputTokens: 20, modelId: 'm2' }), extra)

    const rows = repo.totals(conn, { from: now - 1000, to: now + 1000, groupBy: 'provider', source: 'proxy' })
    expect(rows.length).toBe(1)
    expect(rows[0]?.key).toBe('p1')
    expect(rows[0]?.output).toBe(30)
  })

  it('来源过滤排除测速', async () => {
    const { repo } = await load()
    const conn = db as NonNullable<typeof db>
    const now = Date.now()
    repo.recordRequest(conn, ev({ ts: now, outputTokens: 5, source: 'probe' }), extra)
    repo.recordRequest(conn, ev({ ts: now + 1, outputTokens: 7 }), extra)

    const proxyOnly = repo.totals(conn, { from: now - 1000, to: now + 1000, groupBy: 'model', source: 'proxy' })
    expect(proxyOnly[0]?.output).toBe(7)
    const all = repo.totals(conn, { from: now - 1000, to: now + 1000, groupBy: 'model', source: 'all' })
    expect(all[0]?.output).toBe(12)
  })

  it('Top N 按指定指标排序', async () => {
    const { repo } = await load()
    const conn = db as NonNullable<typeof db>
    const now = Date.now()
    repo.recordRequest(conn, ev({ ts: now, cost: 1, modelId: 'cheap' }), extra)
    repo.recordRequest(conn, ev({ ts: now + 1, cost: 9, modelId: 'pricey' }), extra)

    const top = repo.top(conn, { from: now - 1000, to: now + 1000, by: 'cost', source: 'proxy', limit: 5 })
    expect(top.map((r) => r.key)).toEqual(['pricey', 'cheap'])
  })

  it('分组合计给出 TTFT 分位数', async () => {
    const { repo } = await load()
    const conn = db as NonNullable<typeof db>
    const now = Date.now()
    const samples = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000]
    samples.forEach((ms, i) => repo.recordRequest(conn, ev({ ts: now + i, ttftMs: ms }), extra))

    const rows = repo.totals(conn, { from: now - 1000, to: now + 1000, groupBy: 'model', source: 'proxy' })
    expect(rows[0]?.ttft_p50).toBe(500)
    expect(rows[0]?.ttft_p95).toBe(1000)
    expect(rows[0]?.ttft_p99).toBe(1000)
  })
})

describe('清理', () => {
  it('只删过期明细与过期分钟桶，日聚合保留', async () => {
    const { repo } = await load()
    const conn = db as NonNullable<typeof db>
    const now = Date.now()
    repo.recordRequest(conn, ev({ ts: now - 40 * 86_400_000 }), { ...extra, day: '2026-10-01' })
    repo.recordRequest(conn, ev({ ts: now }), extra)

    const out = repo.prune(conn, now, 30, 30)
    expect(out.requests).toBe(1)
    expect(conn.get<{ c: number }>('select count(*) c from requests')?.c).toBe(1)
    expect(conn.get<{ c: number }>('select count(*) c from rollup_minute')?.c).toBe(1)
    expect(conn.get<{ c: number }>('select count(*) c from rollup_day')?.c).toBe(2)
  })
})

describe('旧数据导入', () => {
  it('把 JSONL 明细与 minute 聚合搬进库并标记完成', async () => {
    const { repo, importer } = await load()
    const conn = db as NonNullable<typeof db>
    const data = join(root, 'data')
    mkdirSync(join(data, 'events'), { recursive: true })
    mkdirSync(join(data, 'rollup'), { recursive: true })

    const ts = new Date('2026-11-12T09:30:00').getTime()
    writeFileSync(join(data, 'events', '2026-11-12.jsonl'), `${JSON.stringify(ev({ ts }))}\n`, 'utf8')
    const minute = Math.floor(ts / 60_000) * 60_000
    writeFileSync(
      join(data, 'rollup', '2026-11-12.json'),
      JSON.stringify({ [minute]: { m1: { out: 50, req: 1, err: 0, cost: 0.1, input: 500, cacheRead: 100, cacheWrite: 0 } } }),
      'utf8'
    )

    const out = importer.importLegacy(conn, data)
    expect(out.requests).toBe(1)
    expect(conn.get<{ c: number }>('select count(*) c from requests')?.c).toBe(1)
    expect(importer.alreadyImported(conn)).toBe(true)

    expect(existsSync(join(data, 'events'))).toBe(false)
    expect(readdirSync(join(data, 'legacy-imported')).length).toBeGreaterThan(0)

    const rows = repo.totals(conn, { from: ts - 1000, to: ts + 1000, groupBy: 'model', source: 'proxy' })
    expect(rows[0]?.input).toBe(1000) // 明细 1000 + 分钟桶 500，两条来源都进了聚合
  })

  it('重复导入不会叠加明细', async () => {
    const { importer } = await load()
    const conn = db as NonNullable<typeof db>
    const data = join(root, 'data')
    mkdirSync(join(data, 'events'), { recursive: true })
    const ts = Date.now()
    const one = JSON.stringify(ev({ ts }))
    writeFileSync(join(data, 'events', '2026-11-12.jsonl'), `${one}\n`, 'utf8')

    importer.importLegacy(conn, data)
    // 第二次手动再跑一遍同样的数据，insert or ignore 保证明细不重复
    const copy = join(root, 'again')
    mkdirSync(join(copy, 'events'), { recursive: true })
    writeFileSync(join(copy, 'events', '2026-11-12.jsonl'), `${one}\n`, 'utf8')
    importer.importLegacy(conn, copy)
    expect(conn.get<{ c: number }>('select count(*) c from requests')?.c).toBe(1)
  })
})
