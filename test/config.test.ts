import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let root = ''

vi.mock('electron', () => ({
  app: { getPath: () => root }
}))

async function load(): Promise<typeof import('../src/main/store/config')> {
  vi.resetModules()
  return import('../src/main/store/config')
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'llmmeter-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('配置读写', () => {
  it('首次启动生成 sk- 签名 token、密钥对与默认端口', async () => {
    const cfg = await load()
    const current = cfg.get()
    expect(current.settings.localToken).toMatch(/^sk-[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
    expect(current.settings.localKey?.kid).toBeTruthy()
    expect(current.settings.port).toBe(8787)
    expect(readdirSync(join(root, 'data'))).toContain('config.json')
  })

  it('落盘不留 .tmp', async () => {
    const cfg = await load()
    cfg.get()
    cfg.mutate((c) => {
      c.settings.retentionDays = 7
    })
    const names = readdirSync(join(root, 'data'))
    expect(names.some((n) => n.endsWith('.tmp'))).toBe(false)
    expect(JSON.parse(readFileSync(join(root, 'data', 'config.json'), 'utf8')).settings.retentionDays).toBe(7)
  })

  it('坏 JSON 时留证并从空配置起', async () => {
    const dir = join(root, 'data')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'config.json'), '{ this is not json', 'utf8')
    const cfg = await load()
    const current = cfg.get()
    expect(current.providers).toEqual([])
    expect(readdirSync(dir).some((n) => n.includes('.corrupt-'))).toBe(true)
  })

  it('丢弃指向不存在供应商的模型，别名重复只留第一个', async () => {
    const dir = join(root, 'data')
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'config.json'),
      JSON.stringify({
        version: 1,
        providers: [{ id: 'p1', name: 'P', baseUrl: 'https://x.test', format: 'openai', keyCipher: '', createdAt: 1 }],
        models: [
          { id: 'm1', providerId: 'p1', upstreamModel: 'a', alias: 'same' },
          { id: 'm2', providerId: 'p1', upstreamModel: 'b', alias: 'same' },
          { id: 'm3', providerId: 'gone', upstreamModel: 'c', alias: 'orphan' }
        ],
        settings: { port: 8787 }
      }),
      'utf8'
    )
    const cfg = await load()
    expect(cfg.get().models.map((m) => m.alias)).toEqual(['same'])
  })

  it('端口被钳制在合法区间，非法 token 会迁移成 sk- 且旧 hex 也保留不改', async () => {
    const dir = join(root, 'data')
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'config.json'),
      JSON.stringify({ version: 1, providers: [], models: [], settings: { port: 80, localToken: 'zzz' } }),
      'utf8'
    )
    const cfg = await load()
    expect(cfg.get().settings.port).toBe(1024)
    expect(cfg.get().settings.localToken).toMatch(/^sk-/)
  })

  it('旧 32 位 hex token 会连密钥对一起迁移成 sk-', async () => {
    const dir = join(root, 'data')
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'config.json'),
      JSON.stringify({ version: 1, providers: [], models: [], settings: { localToken: 'a'.repeat(32) } }),
      'utf8'
    )
    const cfg = await load()
    expect(cfg.get().settings.localToken).toMatch(/^sk-/)
    expect(cfg.get().settings.localKey).not.toBeNull()
  })

  it('已有的 sk- token 与密钥对原样保留', async () => {
    const { issue } = await import('../src/main/security/token')
    const { key, token: sk } = issue()
    const dir = join(root, 'data')
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'config.json'),
      JSON.stringify({ version: 1, providers: [], models: [], settings: { localToken: sk, localKey: key } }),
      'utf8'
    )
    const cfg = await load()
    expect(cfg.get().settings.localToken).toBe(sk)
    expect(cfg.get().settings.localKey).toEqual(key)
  })

  it('价格来源缺省按自动，manual 原样保留；开机自启/自动校准有默认值', async () => {
    const dir = join(root, 'data')
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'config.json'),
      JSON.stringify({
        version: 1,
        providers: [{ id: 'p1', name: 'p', baseUrl: 'https://x.test', format: 'openai', keyCipher: '', createdAt: 1 }],
        models: [
          { id: 'm1', providerId: 'p1', upstreamModel: 'u1', alias: 'a1', createdAt: 1 },
          { id: 'm2', providerId: 'p1', upstreamModel: 'u2', alias: 'a2', priceSource: 'manual', autoProbe: true, createdAt: 2 }
        ],
        settings: {}
      }),
      'utf8'
    )
    const cfg = await load()
    expect(cfg.get().models.find((m) => m.id === 'm1')?.priceSource).toBe('auto')
    expect(cfg.get().models.find((m) => m.id === 'm2')?.priceSource).toBe('manual')
    expect(cfg.get().models.find((m) => m.id === 'm1')?.autoProbe).toBe(false)
    expect(cfg.get().models.find((m) => m.id === 'm2')?.autoProbe).toBe(true)
    expect(cfg.get().settings.startAtLogin).toBe(false)
    expect(cfg.get().settings.autoCalibrate).toBe(true)
    expect(cfg.get().settings.autoProbeIntervalSec).toBe(300)
    expect(cfg.get().settings.lastCalibrate).toBeNull()
  })

  it('baseUrl 去掉末尾斜杠', async () => {
    const dir = join(root, 'data')
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'config.json'),
      JSON.stringify({
        version: 1,
        providers: [{ id: 'p1', baseUrl: 'https://x.test///', format: 'openai' }],
        models: [],
        settings: {}
      }),
      'utf8'
    )
    const cfg = await load()
    expect(cfg.get().providers[0]?.baseUrl).toBe('https://x.test')
  })
})
