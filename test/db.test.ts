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

  it('探针没有 token 时备注落为默认', async () => {
    const { repo } = await load()
    const conn = db as NonNullable<typeof db>
    repo.recordRequest(conn, ev({ source: 'probe' }), extra)
    expect(conn.get<{ v: string }>('select token_remark v from requests')?.v).toBe('默认')
    expect(conn.get<{ c: number }>('select count(*) c from rollup_token_minute')?.c).toBe(1)
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
  it('时间序列铺满区间，只有有数据的桶有值', async () => {
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
    expect(out.buckets.length).toBe(11)
    expect(out.series[0]?.key).toBe('m1')
    expect(out.series[0]?.points.length).toBe(11)
    expect(out.series[0]?.points[1]).toBe(100)
    expect(out.series[0]?.points[3]).toBe(300)
    expect(out.series[0]?.points.reduce((a, b) => a + b, 0)).toBe(400)
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

  it('按 token 备注聚合序列与合计', async () => {
    const { repo } = await load()
    const conn = db as NonNullable<typeof db>
    const now = Date.now()
    repo.recordRequest(conn, ev({ ts: now, outputTokens: 10 }), { ...extra, tokenRemark: '笔记本' })
    repo.recordRequest(conn, ev({ ts: now + 1, outputTokens: 20 }), { ...extra, tokenRemark: '脚本' })
    const s = repo.series(conn, { from: Math.floor(now / 60000) * 60000, to: Math.floor(now / 60000) * 60000 + 60000, granularity: 'minute', metric: 'output', groupBy: 'token', source: 'all' })
    expect(s.series.map((x) => x.key).sort()).toEqual(['笔记本', '脚本'])
    const t = repo.totals(conn, { from: now - 1000, to: now + 1000, groupBy: 'token', source: 'all' })
    expect(t.find((x) => x.key === '笔记本')?.output).toBe(10)
  })

  it('空时段也占用时间桶，不跳过', async () => {
    const { repo } = await load()
    const conn = db as NonNullable<typeof db>
    const base = Math.floor(Date.now() / 60000) * 60000
    repo.recordRequest(conn, ev({ ts: base }), extra)
    repo.recordRequest(conn, ev({ ts: base + 120_000 }), extra)
    const s = repo.series(conn, { from: base, to: base + 180_000, granularity: 'minute', metric: 'requests', groupBy: 'model', source: 'all' })
    expect(s.buckets).toHaveLength(3)
    expect(s.series[0]?.points).toHaveLength(3)
    expect(s.series[0]?.points[1]).toBe(0)
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

    // 探针样本不进分位
    repo.recordRequest(conn, ev({ ts: now + 20, ttftMs: 9999, source: 'probe' }), extra)
    const again = repo.totals(conn, { from: now - 1000, to: now + 1000, groupBy: 'model', source: 'all' })
    expect(again[0]?.ttft_p99).toBe(1000)
  })
})

describe('日志查询', () => {
  it('按模型、来源、结果、关键字与时间过滤并分页', async () => {
    const { repo } = await load()
    const conn = db as NonNullable<typeof db>
    const now = Date.now()
    repo.recordRequest(conn, ev({ ts: now }), extra)
    repo.recordRequest(conn, ev({ ts: now + 1, source: 'probe', ok: false, status: 500, errorKind: 'upstream_5xx' }), extra)
    repo.recordRequest(conn, ev({ ts: now + 2, modelId: 'm2', alias: 'other' }), extra)

    const base = { from: now - 1000, to: now + 1000, page: 1, pageSize: 10 }
    expect(repo.queryRequests(conn, base).total).toBe(3)
    expect(repo.queryRequests(conn, { ...base, modelId: 'm2' }).rows.map((r) => r.alias)).toEqual(['other'])
    expect(repo.queryRequests(conn, { ...base, source: 'probe' }).total).toBe(1)
    expect(repo.queryRequests(conn, { ...base, ok: false }).total).toBe(1)
    expect(repo.queryRequests(conn, { ...base, keyword: 'up-1' }).total).toBe(3)
    expect(repo.queryRequests(conn, { ...base, keyword: 'nothing' }).total).toBe(0)
    expect(repo.queryRequests(conn, { ...base, to: now - 500 }).total).toBe(0)
    const paged = repo.queryRequests(conn, { ...base, page: 2, pageSize: 2 })
    expect(paged.total).toBe(3)
    expect(paged.rows).toHaveLength(1)
    expect(repo.queryRequests(conn, base).rows[0]?.providerName).toBe('供应商')
  })

  it('运行日志按级别与关键字过滤', async () => {
    const { repo } = await load()
    const conn = db as NonNullable<typeof db>
    const now = Date.now()
    repo.insertAppLog(conn, 'a', now, 'info', 'startup', '应用启动')
    repo.insertAppLog(conn, 'b', now + 1, 'warn', 'probe', '模型超时')
    repo.insertAppLog(conn, 'c', now + 2, 'error', 'proxy', '端口占用')

    const base = { from: now - 1000, to: now + 1000, page: 1, pageSize: 10 }
    expect(repo.queryAppLogs(conn, base).total).toBe(3)
    expect(repo.queryAppLogs(conn, { ...base, level: 'warn' }).rows[0]?.message).toBe('模型超时')
    expect(repo.queryAppLogs(conn, { ...base, keyword: '端口' }).rows[0]?.level).toBe('error')
  })
})

describe('清理', () => {
  it('只删过期明细与过期分钟桶，日聚合保留', async () => {
    const { repo } = await load()
    const conn = db as NonNullable<typeof db>
    const now = Date.now()
    repo.recordRequest(conn, ev({ ts: now - 40 * 86_400_000 }), { ...extra, day: '2026-10-01' })
    repo.recordRequest(conn, ev({ ts: now }), extra)
    repo.insertAppLog(conn, 'old', now - 40 * 86_400_000, 'info', 'startup', '旧日志')
    repo.insertAppLog(conn, 'new', now, 'info', 'startup', '新日志')

    const out = repo.prune(conn, now, 30, 30)
    expect(out.requests).toBe(1)
    expect(conn.get<{ c: number }>('select count(*) c from requests')?.c).toBe(1)
    expect(conn.get<{ c: number }>('select count(*) c from app_logs')?.c).toBe(1)
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
