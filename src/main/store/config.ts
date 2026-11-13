import { randomUUID } from 'node:crypto'
import { readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs'
import { configPath, ensureDirs } from './paths'
import * as token from '../security/token'
import type { ConfigFile, ModelCfg, Provider, Settings } from '../../shared/types'

const DEFAULT_SETTINGS: Settings = {
  port: 8787,
  allowLan: false,
  usdCny: 7.2,
  usdCnyDate: '',
  localToken: '',
  localKey: null,
  tokens: [],
  retentionDays: 30,
  rollupRetentionDays: 365,
  overlay: {
    x: null,
    y: null,
    width: 320,
    visible: true,
    modelId: null,
    locked: false,
    theme: 'dark'
  },
  overlayOpacity: 100,
  startMinimized: false,
  startAtLogin: false,
  autoCalibrate: true,
  autoProbeIntervalSec: 300,
  lastCalibrate: null
}

let cache: ConfigFile | null = null
const listeners = new Set<(c: ConfigFile) => void>()

function emptyConfig(): ConfigFile {
  const issued = token.issue()
  return {
    version: 1,
    providers: [],
    models: [],
    settings: {
      ...DEFAULT_SETTINGS,
      overlay: { ...DEFAULT_SETTINGS.overlay },
      localKey: null,
      localToken: issued.token,
      tokens: [{ id: randomUUID(), remark: '默认', token: issued.token, createdAt: Date.now() }]
    }
  }
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback
}

/** 手改坏了也要能起来：字段逐个兜底，非法条目丢弃。 */
function normalize(raw: unknown): ConfigFile {
  const base = emptyConfig()
  if (!raw || typeof raw !== 'object') return base
  const r = raw as Record<string, unknown>

  const providers: Provider[] = []
  if (Array.isArray(r.providers)) {
    for (const p of r.providers) {
      if (!p || typeof p !== 'object') continue
      const o = p as Record<string, unknown>
      const baseUrl = str(o.baseUrl).trim().replace(/\/+$/, '')
      if (!baseUrl) continue
      providers.push({
        id: str(o.id) || randomUUID(),
        name: str(o.name).trim() || baseUrl,
        baseUrl,
        format: o.format === 'anthropic' ? 'anthropic' : 'openai',
        keyCipher: str(o.keyCipher),
        enabled: o.enabled !== false,
        createdAt: num(o.createdAt, Date.now())
      })
    }
  }

  const ids = new Set(providers.map((p) => p.id))
  const aliases = new Set<string>()
  const models: ModelCfg[] = []
  if (Array.isArray(r.models)) {
    for (const m of r.models) {
      if (!m || typeof m !== 'object') continue
      const o = m as Record<string, unknown>
      const providerId = str(o.providerId)
      const alias = str(o.alias).trim()
      const upstreamModel = str(o.upstreamModel).trim()
      if (!ids.has(providerId) || !alias || !upstreamModel || aliases.has(alias)) continue
      aliases.add(alias)
      models.push({
        id: str(o.id) || randomUUID(),
        providerId,
        upstreamModel,
        alias,
        enabled: o.enabled !== false,
        watch: o.watch !== false,
        showRate: o.showRate !== false,
        priceIn: Math.max(0, num(o.priceIn, 0)),
        priceOut: Math.max(0, num(o.priceOut, 0)),
        priceCacheRead: Math.max(0, num(o.priceCacheRead, 0)),
        priceCacheInput: Math.max(0, num(o.priceCacheInput, 0)),
        currency: str(o.currency, 'USD') || 'USD',
        priceSource: o.priceSource === 'manual' ? 'manual' : 'auto',
        autoProbe: o.autoProbe === true,
        sort: num(o.sort, models.length),
        createdAt: num(o.createdAt, Date.now())
      })
    }
  }

  const os = (r.settings ?? {}) as Record<string, unknown>
  const ov = (os.overlay ?? {}) as Record<string, unknown>
  // 已有的 sk- token + 密钥对原样保留；旧 16 字节 hex 或缺密钥的，迁移成签名 token
  const storedKey = token.parseKey(os.localKey)
  const storedToken = str(os.localToken)
  const signed = storedToken.includes('.')
  const keep = storedToken.startsWith('sk-') && (!signed || storedKey !== null)
  const issued = keep ? null : token.issue()
  const settings: Settings = {
    port: clamp(Math.round(num(os.port, DEFAULT_SETTINGS.port)), 1024, 65535),
    allowLan: os.allowLan === true,
    usdCny: clamp(num(os.usdCny, DEFAULT_SETTINGS.usdCny), 1, 20),
    usdCnyDate: /^\d{4}-\d{2}-\d{2}$/.test(str(os.usdCnyDate)) ? str(os.usdCnyDate) : '',
    localToken: keep ? storedToken : issued!.token,
    localKey: keep ? (signed ? storedKey : null) : null,
    tokens: [],
    retentionDays: clamp(Math.round(num(os.retentionDays, DEFAULT_SETTINGS.retentionDays)), 1, 3650),
    rollupRetentionDays: clamp(
      Math.round(num(os.rollupRetentionDays, DEFAULT_SETTINGS.rollupRetentionDays)),
      1,
      3650
    ),
    overlay: {
      x: typeof ov.x === 'number' ? ov.x : null,
      y: typeof ov.y === 'number' ? ov.y : null,
      width: clamp(Math.round(num(ov.width, DEFAULT_SETTINGS.overlay.width)), 240, 720),
      visible: ov.visible !== false,
      modelId: typeof ov.modelId === 'string' && ov.modelId ? ov.modelId : null,
      locked: ov.locked === true,
      theme: ov.theme === 'light' ? 'light' : 'dark'
    },
    overlayOpacity: clamp(Math.round(num(os.overlayOpacity, DEFAULT_SETTINGS.overlayOpacity)), 10, 100),
    startMinimized: os.startMinimized === true,
    startAtLogin: os.startAtLogin === true,
    autoCalibrate: os.autoCalibrate !== false,
    autoProbeIntervalSec: clamp(Math.round(num(os.autoProbeIntervalSec, 300)), 60, 3600),
    lastCalibrate:
      os.lastCalibrate && typeof os.lastCalibrate === 'object'
        ? (os.lastCalibrate as { at: number; rate: number; updated: number; missed: number })
        : null
  }

  // 旧配置没有命名 token 列表：把现有本地 token 收编为「默认」，保证仍可用
  const rawTokens = Array.isArray(os.tokens) ? os.tokens : []
  const seen = new Set<string>()
  for (const item of rawTokens) {
    const t = (item ?? {}) as Record<string, unknown>
    const remark = str(t.remark).trim()
    const value = str(t.token)
    if (!remark || !value || seen.has(remark)) continue
    seen.add(remark)
    settings.tokens.push({
      id: typeof t.id === 'string' && t.id ? t.id : randomUUID(),
      remark,
      token: value,
      createdAt: num(t.createdAt, Date.now())
    })
  }
  if (settings.tokens.length === 0) {
    settings.tokens.push({
      id: randomUUID(),
      remark: '默认',
      token: settings.localToken,
      createdAt: Date.now()
    })
  }
  // 历史配置里的外币单价一次性折成人民币，之后不再重复折算
  for (const m of models) {
    if (m.currency === 'CNY') continue
    const rate = m.currency === 'USD' ? settings.usdCny : 1
    m.priceIn *= rate
    m.priceOut *= rate
    m.priceCacheRead *= rate
    m.priceCacheInput *= rate
    m.currency = 'CNY'
  }

  return { version: 1, providers, models, settings }
}

export function get(): ConfigFile {
  if (cache) return cache
  ensureDirs()
  const file = configPath()
  if (!existsSync(file)) {
    cache = emptyConfig()
    persist(cache)
    return cache
  }
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
    cache = normalize(parsed)
  } catch {
    // 坏文件留证后从空配置起，不阻塞启动
    try {
      renameSync(file, `${file}.corrupt-${Date.now()}`)
    } catch {
      /* 忽略 */
    }
    cache = emptyConfig()
    persist(cache)
  }
  return cache
}

function persist(cfg: ConfigFile): void {
  ensureDirs()
  const file = configPath()
  const tmp = `${file}.tmp`
  writeFileSync(tmp, JSON.stringify(cfg, null, 2), 'utf8')
  renameSync(tmp, file)
}

/** 读-改-写。mutator 返回值会被忽略，改动直接体现在可变副本上。 */
export function mutate(mutator: (cfg: ConfigFile) => void): ConfigFile {
  const cfg = structuredClone(get())
  mutator(cfg)
  cache = cfg
  persist(cfg)
  for (const fn of listeners) fn(cfg)
  return cfg
}

export function onChange(fn: (c: ConfigFile) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function providerById(id: string): Provider | undefined {
  return get().providers.find((p) => p.id === id)
}

export function modelByAlias(alias: string): ModelCfg | undefined {
  return get().models.find((m) => m.alias === alias)
}

export function modelByUpstream(name: string): ModelCfg | undefined {
  const hits = get().models.filter((m) => m.upstreamModel === name)
  return hits.length === 1 ? hits[0] : undefined
}

export function modelById(id: string): ModelCfg | undefined {
  return get().models.find((m) => m.id === id)
}

export function listModels(): ModelCfg[] {
  return [...get().models].sort((a, b) => a.sort - b.sort || a.alias.localeCompare(b.alias))
}

export function listProviders(): Provider[] {
  return [...get().providers].sort((a, b) => a.name.localeCompare(b.name))
}
