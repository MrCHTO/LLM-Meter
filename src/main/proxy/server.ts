import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { createHash, randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ApiFormat, ErrorKind, ModelCfg, Provider, RequestEvent } from '../../shared/types'
import { FORMAT_MOUNT } from '../../shared/types'
import * as cfg from '../store/config'
import * as live from '../store/live'
import * as db from '../store/db'
import * as repo from '../store/db/repo'
import { dayKey } from '../store/paths'
import { open as openKey } from '../security/keys'
import * as token from '../security/token'
import { adapterFor } from './adapters'
import { SseTap } from './sse'
import { joinUrl } from './url'
import { cost, EMPTY_USAGE, normalizeUsage, type Usage } from '../metrics/cost'

const BODY_LIMIT = 64 * 1024 * 1024
const TIMEOUT_MS = 300_000
const MAX_PORT_TRIES = 20
const HOP_BY_HOP = new Set([
  'host',
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'content-length',
  'accept-encoding',
  'authorization',
  'x-api-key'
])

export interface ProxyState {
  running: boolean
  port: number
  error: string | null
}

interface Deps {
  record: (ev: RequestEvent) => void
}

let server: Server | null = null
let state: ProxyState = { running: false, port: 0, error: null }
const deps: Deps = {
  record: () => undefined
}

export function bindDeps(d: Deps): void {
  deps.record = d.record
}

export function getState(): ProxyState {
  return { ...state }
}

export function baseUrl(): string {
  return state.running ? `http://127.0.0.1:${state.port}` : ''
}

function json(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body)
  })
  res.end(body)
}

function fail(res: ServerResponse, status: number, message: string, kind: ErrorKind): void {
  json(res, status, { error: { type: kind, message } })
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > BODY_LIMIT) {
        reject(new Error('请求体超过 64MB'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function detectFormat(path: string): { format: ApiFormat; rest: string } | null {
  for (const format of Object.keys(FORMAT_MOUNT) as ApiFormat[]) {
    const mount = FORMAT_MOUNT[format]
    if (path === mount || path.startsWith(`${mount}/`)) {
      return { format, rest: path.slice(mount.length) || '/' }
    }
  }
  if (path.startsWith('/v1/messages')) return { format: 'anthropic', rest: path }
  if (path.startsWith('/v1/chat/completions') || path.startsWith('/v1/responses')) {
    return { format: 'openai', rest: path }
  }
  return null
}

function resolveModel(alias: string, format: ApiFormat): { model?: ModelCfg; provider?: Provider; error?: string } {
  const byAlias = cfg.modelByAlias(alias) ?? cfg.modelByUpstream(alias)
  if (!byAlias) return { error: `未登记的模型：${alias}` }
  if (!byAlias.enabled) return { error: `模型已停用：${alias}` }
  const provider = cfg.providerById(byAlias.providerId)
  if (!provider) return { error: '供应商已删除' }
  if (!provider.enabled) return { error: `供应商已停用：${provider.name}` }
  if (provider.format !== format) {
    return { error: `模型 ${alias} 属于 ${provider.format} 格式，当前路径是 ${format}` }
  }
  return { model: byAlias, provider }
}

function recordEvent(input: {
  model: ModelCfg
  provider: Provider
  status: number
  ok: boolean
  errorKind: ErrorKind | null
  stream: boolean
  ttftMs: number | null
  durationMs: number
  usage: Usage
  source: RequestEvent['source']
  note?: string
  cacheInputReported?: boolean
  tokenId?: string | null
  tokenRemark?: string | null
}): void {
  const ev: RequestEvent = {
    id: randomUUID(),
    ts: Date.now(),
    source: input.source,
    modelId: input.model.id,
    alias: input.model.alias,
    providerId: input.provider.id,
    status: input.status,
    ok: input.ok,
    errorKind: input.errorKind,
    stream: input.stream,
    ttftMs: input.ttftMs,
    durationMs: input.durationMs,
    inputTokens: input.usage.input,
    uncachedInputTokens: input.usage.uncached,
    outputTokens: input.usage.output,
    cacheReadTokens: input.usage.cacheRead,
    cacheInputTokens: input.usage.cacheInput,
    cacheInputReported: input.cacheInputReported === true,
    cost: input.ok ? cost(input.model, input.usage) : 0,
    currency: input.model.currency,
    note: input.note
  }
  live.record(ev)
  try {
    repo.recordRequest(db.get(), ev, {
      day: dayKey(ev.ts),
      providerName: input.provider.name,
      baseUrl: input.provider.baseUrl,
      upstreamModel: input.model.upstreamModel,
      priceIn: input.model.priceIn,
      priceOut: input.model.priceOut,
      priceCacheRead: input.model.priceCacheRead,
      priceCacheInput: input.model.priceCacheInput,
      tokenId: input.tokenId ?? null,
      tokenRemark: input.tokenRemark ?? null
    })
  } catch (err) {
    console.error('[db] 写入失败', err)
  }
  deps.record(ev)
}

function classify(status: number): ErrorKind {
  return status >= 500 ? 'upstream_5xx' : 'upstream_4xx'
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  const pathname = url.pathname

  if (pathname === '/healthz') {
    json(res, 200, { ok: true, uptime: process.uptime() })
    return
  }

  const auth = token.fromHeaders(req.headers)
  const settings = cfg.get().settings
  const matched = token.matchToken(settings.tokens, auth)
  if (!matched && !token.verifyToken(settings.localKey, settings.localToken, auth)) {
    fail(res, 401, '本地 token 不对，请在接入页复制正确的 token', 'auth')
    return
  }

  if (pathname === '/') {
    json(res, 200, {
      name: 'LLM Meter',
      endpoints: Object.entries(FORMAT_MOUNT).map(([f, mount]) => ({
        format: f,
        base_url: `${baseUrl()}${mount}`
      })),
      models: cfg.listModels().filter((m) => m.enabled).map((m) => m.alias)
    })
    return
  }

  const detected = detectFormat(pathname)
  if (!detected) {
    fail(res, 404, `不认识的路径 ${pathname}，请用 /openai/v1/... 或 /anthropic/v1/...`, 'not_found')
    return
  }

  const method = req.method ?? 'GET'
  const started = Date.now()
  let raw: Buffer = Buffer.alloc(0)
  let payload: Record<string, unknown> = {}

  if (method !== 'GET' && method !== 'HEAD') {
    try {
      raw = await readBody(req)
    } catch (err) {
      fail(res, 413, err instanceof Error ? err.message : '读取请求体失败', 'network')
      return
    }
    if (raw.length > 0) {
      try {
        const parsed: unknown = JSON.parse(raw.toString('utf8'))
        if (parsed && typeof parsed === 'object') payload = parsed as Record<string, unknown>
      } catch {
        fail(res, 400, '请求体不是合法 JSON', 'parse')
        return
      }
    }
  }

  let requested = typeof payload.model === 'string' ? payload.model : (url.searchParams.get('model') ?? '')
  if (!requested && (method === 'GET' || method === 'HEAD')) {
    // /v1/models 之类没有 model 的探测请求，落到该格式下第一个可用模型
    requested =
      cfg
        .listModels()
        .find(
          (m) => m.enabled && cfg.providerById(m.providerId)?.enabled && cfg.providerById(m.providerId)?.format === detected.format
        )?.alias ?? ''
  }
  if (!requested) {
    fail(res, 400, '请求体缺少 model 字段', 'parse')
    return
  }

  const resolved = resolveModel(requested, detected.format)
  if (!resolved.model || !resolved.provider) {
    fail(res, 404, resolved.error ?? '模型不可用', 'not_found')
    return
  }

  const { model, provider } = resolved
  const key = openKey(provider.keyCipher)
  if (!key) {
    fail(res, 502, `供应商 ${provider.name} 没有可用的 API Key，请重新填写`, 'auth')
    return
  }

  const adapter = adapterFor(provider.format)
  const prepared =
    method === 'GET' || method === 'HEAD'
      ? { body: '', stream: false }
      : adapter.prepare(payload, model.upstreamModel)

  const headers: Record<string, string> = { ...adapter.baseHeaders(), ...adapter.auth(key) }
  for (const [name, value] of Object.entries(req.headers)) {
    if (HOP_BY_HOP.has(name) || value === undefined) continue
    headers[name] = Array.isArray(value) ? value.join(', ') : value
  }
  headers['accept-encoding'] = 'identity'

  const rest = detected.rest.startsWith('/') ? detected.rest : `/${detected.rest}`
  const target = joinUrl(provider.baseUrl, rest, url.search)
  // 客户端可能带着自己的 model 查询参数，以 alias 走一遍替换
  if (target.searchParams.get('model')) target.searchParams.set('model', model.upstreamModel)

  const controller = new AbortController()
  let abortedByClient = false
  let timeoutHit = false
  const timer = setTimeout(() => {
    timeoutHit = true
    controller.abort()
  }, TIMEOUT_MS)

  res.on('close', () => {
    if (!res.writableEnded) {
      abortedByClient = true
      controller.abort()
    }
  })

  let usage: Usage = { ...EMPTY_USAGE }
    let reportedCacheInput = false
  let ttftMs: number | null = null
  let chars = 0
  let upstreamError: string | null = null
  let status = 0

  try {
    live.begin(model.id)
    const upstream = await fetch(target, {
      method,
      headers,
      body: method === 'GET' || method === 'HEAD' ? undefined : prepared.body,
      signal: controller.signal,
      redirect: 'follow'
    })
    status = upstream.status
    if (process.env.LLM_METER_DEBUG) {
      console.log(`[debug] → ${method} ${target.toString()}`)
      console.log(`[debug] body=${(prepared.body ?? '').slice(0, 220)} len=${prepared.body?.length ?? 0}`)
      const safe = { ...headers }
      if (safe.authorization) safe.authorization = `Bearer ${'*'.repeat(8)}`
      console.log('[debug] headers', JSON.stringify(safe))
      console.log('[debug] bodySha', createHash('sha256').update(prepared.body ?? '').digest('hex').slice(0, 16))
      if (process.env.TEMP) writeFileSync(join(process.env.TEMP, 'llmmeter-body.json'), prepared.body ?? '', 'utf8')
    }

    const passed: Record<string, string> = {}
    upstream.headers.forEach((value, name) => {
      if (HOP_BY_HOP.has(name) || name === 'content-encoding') return
      passed[name] = value
    })

    if (!upstream.ok) {
      const text = await upstream.text()
      upstreamError = adapter.errorOf(text) ?? text.slice(0, 400)
      res.writeHead(status, { ...passed, 'content-type': passed['content-type'] ?? 'application/json' })
      res.end(text)
      recordEvent({
        model,
        provider,
        status,
        ok: false,
        errorKind: classify(status),
        stream: prepared.stream,
        ttftMs: null,
        durationMs: Date.now() - started,
        usage,
        source: 'proxy',
      cacheInputReported: reportedCacheInput,
      tokenId: matched?.id ?? null,
      tokenRemark: matched?.remark ?? null,
        note: upstreamError ?? undefined
      })
      return
    }

    // 以响应头判断是否流式：有的上游根本不管请求里的 stream 字段
    const isSse = (upstream.headers.get('content-type') ?? '').includes('text/event-stream')

    if (!isSse) {
      const buf = Buffer.from(await upstream.arrayBuffer())
      const parsed = adapter.parseUsage(buf.toString('utf8'))
      if (parsed) {
        usage = { ...usage, ...parsed.usage }
        usage = normalizeUsage(usage.input, usage.cacheRead, usage.cacheInput, usage.output)
        if (parsed.reportedCacheInput) reportedCacheInput = true
      }
      res.writeHead(status || 200, passed)
      res.end(buf)
      recordEvent({
        model,
        provider,
        status: status || 200,
        ok: true,
        errorKind: null,
        stream: false,
        ttftMs: null,
        durationMs: Date.now() - started,
        usage,
        source: 'proxy',
      cacheInputReported: reportedCacheInput,
      tokenId: matched?.id ?? null,
      tokenRemark: matched?.remark ?? null,
      })
      return
    }

    res.writeHead(status || 200, { ...passed, 'content-type': passed['content-type'] ?? 'text/event-stream' })

    const tap = new SseTap()
    const reader = upstream.body?.getReader()
    if (!reader) throw new Error('上游没有返回响应体')

    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = Buffer.from(value)
      // 原始字节先原样转发，绝不因为解析失败而改动客户端看到的内容
      res.write(chunk)

      for (const frame of tap.feed(chunk)) {
        const info = adapter.onFrame(frame)
        chars += info.chars
        if (info.firstContent && ttftMs === null) ttftMs = Date.now() - started
        live.noteDelta(model.id, info.cjk, info.other)
        if (info.usage) {
          usage = { ...usage, ...info.usage }
          usage = normalizeUsage(usage.input, usage.cacheRead, usage.cacheInput, usage.output)
          if (info.reportedCacheInput) reportedCacheInput = true
          if (process.env.LLM_METER_DEBUG) console.log('[debug] usage', JSON.stringify(info.usage))
        }
        if (info.error) upstreamError = info.error
      }
    }

    res.end()
    if (usage.output === 0 && chars > 0) {
      // 上游没给 usage 时的兜底估算，只影响展示
      usage = { ...usage, output: Math.max(1, Math.round(chars / 4)) }
    }
    recordEvent({
      model,
      provider,
      status: status || 200,
      ok: true,
      errorKind: null,
      stream: true,
      ttftMs,
      durationMs: Date.now() - started,
      usage,
      source: 'proxy',
      cacheInputReported: reportedCacheInput,
      tokenId: matched?.id ?? null,
      tokenRemark: matched?.remark ?? null,
      note: upstreamError ?? undefined
    })
  } catch (err) {
    const kind: ErrorKind = timeoutHit ? 'timeout' : abortedByClient ? 'aborted' : 'network'
    const message = timeoutHit
      ? `上游 ${TIMEOUT_MS / 1000}s 未完成`
      : abortedByClient
        ? '客户端提前断开'
        : err instanceof Error
          ? err.message
          : '转发失败'

    if (!res.headersSent) fail(res, 504, message, kind)
    else res.end()

    recordEvent({
      model,
      provider,
      status: status || 0,
      ok: false,
      errorKind: kind,
      stream: prepared.stream,
      ttftMs,
      durationMs: Date.now() - started,
      usage,
      source: 'proxy',
      cacheInputReported: reportedCacheInput,
      tokenId: matched?.id ?? null,
      tokenRemark: matched?.remark ?? null,
      note: message
    })
  } finally {
    clearTimeout(timer)
    live.end(model.id)
  }
}

function listenOn(port: number, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer((req, res) => {
      handle(req, res).catch((err: unknown) => {
        console.error('[proxy] handler crash', err)
        if (!res.headersSent) fail(res, 500, '代理内部错误', 'network')
        else res.end()
      })
    })
    s.on('error', (err: NodeJS.ErrnoException) => {
      s.close()
      reject(err)
    })
    s.listen(port, host, () => {
      server = s
      resolve(port)
    })
  })
}

export async function start(preferred: number): Promise<ProxyState> {
  await stop()
  state = { running: false, port: 0, error: null }
  // 允许局域网访问时绑 0.0.0.0，否则只绑回环
  const host = cfg.get().settings.allowLan ? '0.0.0.0' : '127.0.0.1'
  for (let i = 0; i < MAX_PORT_TRIES; i++) {
    const port = preferred + i
    if (port > 65535) break
    try {
      await listenOn(port, host)
      state = { running: true, port, error: null }
      if (port !== preferred) {
        cfg.mutate((c) => {
          c.settings.port = port
        })
      }
      console.log(`[proxy] listening on ${host}:${port}`)
      return getState()
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EADDRINUSE') {
        state = { running: false, port: 0, error: (err as Error).message }
        return getState()
      }
      console.warn(`[proxy] port ${port} busy, trying next`)
    }
  }
  state = { running: false, port: 0, error: '找不到可用端口' }
  return getState()
}

export async function stop(): Promise<void> {
  if (!server) return
  const s = server
  server = null
  await new Promise<void>((resolve) => {
    s.closeAllConnections?.()
    s.close(() => resolve())
  })
  state = { running: false, port: 0, error: null }
}
