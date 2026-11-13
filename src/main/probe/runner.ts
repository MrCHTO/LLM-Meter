import { randomUUID } from 'node:crypto'
import type { ModelCfg, ProbeResult, Provider, RequestEvent } from '../../shared/types'
import * as cfg from '../store/config'
import * as live from '../store/live'
import * as applog from '../applog'
import * as db from '../store/db'
import * as repo from '../store/db/repo'
import { dayKey } from '../store/paths'
import { open as openKey } from '../security/keys'
import { adapterFor } from './../proxy/adapters'
import { SseTap } from '../proxy/sse'
import { joinUrl } from '../proxy/url'
import { cost, EMPTY_USAGE, normalizeUsage, type Usage } from '../metrics/cost'

const TIMEOUT_MS = 120_000
const FILLER = '温度、气压与湿度沿着海岸线缓慢变化，The quick brown fox jumps over the lazy dog。'

const active = new Map<string, AbortController>()
/** 上一次测速结束的时间，连续点多个模型时留个间隔 */
let lastFinished = 0
const MIN_GAP_MS = 1500

/**
 * 只测速度：一次请求，看首字与生成速率，不比对缓存。
 * 刻意不发 temperature——有的模型只接受固定值（Kimi K3 只允许 1），发 0 会 400。
 */
export function probeBody(): Record<string, unknown> {
  return {
    messages: [
      {
        role: 'user',
        content: `请用中文写一段约 400 字的说明，介绍沿海气候的特点。${FILLER}`
      }
    ],
    max_tokens: 320,
    stream: true,
    stream_options: { include_usage: true }
  }
}

interface Run {
  status: number
  ok: boolean
  ttftMs: number | null
  tps: number | null
  inputTokens: number
  outputTokens: number
  error?: string
}

function persist(model: ModelCfg, provider: Provider, run: Run, usage: Usage, started: number): void {
  const ev: RequestEvent = {
    id: randomUUID(),
    ts: Date.now(),
    source: 'probe',
    modelId: model.id,
    alias: model.alias,
    providerId: provider.id,
    status: run.status,
    ok: run.ok,
    errorKind: run.ok ? null : run.status >= 500 ? 'upstream_5xx' : run.status ? 'upstream_4xx' : 'network',
    stream: true,
    ttftMs: run.ttftMs,
    durationMs: Date.now() - started,
    inputTokens: usage.input,
    uncachedInputTokens: usage.uncached,
    outputTokens: usage.output,
    cacheReadTokens: usage.cacheRead,
    cacheInputTokens: usage.cacheInput,
    cost: run.ok ? cost(model, usage) : 0,
    currency: model.currency,
    note: run.error
  }
  live.record(ev)
  try {
    repo.recordRequest(db.get(), ev, {
      day: dayKey(ev.ts),
      providerName: provider.name,
      baseUrl: provider.baseUrl,
      upstreamModel: model.upstreamModel,
      priceIn: model.priceIn,
      priceOut: model.priceOut,
      priceCacheRead: model.priceCacheRead,
      priceCacheInput: model.priceCacheInput
    })
  } catch (err) {
    console.error('[db] 写入失败', err)
  }
  if (!run.ok) {
    applog.warn('probe', `${model.alias} 探针失败：${run.status || '无响应'}${run.error ? ` ${run.error}` : ''}`)
  }
}

export function isRunning(modelId: string): boolean {
  return active.has(modelId)
}

export function stop(modelId?: string): void {
  if (modelId) {
    active.get(modelId)?.abort()
    return
  }
  for (const c of active.values()) c.abort()
}

export async function run(modelId: string): Promise<ProbeResult> {
  const blank: ProbeResult = {
    modelId,
    alias: modelId,
    ok: false,
    status: 0,
    ttftMs: null,
    tps: null,
    inputTokens: 0,
    outputTokens: 0,
    message: ''
  }

  const model = cfg.modelById(modelId)
  if (!model) return { ...blank, message: '模型不存在' }
  const base: ProbeResult = { ...blank, alias: model.alias }
  if (active.has(modelId)) return { ...base, message: '该模型正在测速' }

  const provider = cfg.providerById(model.providerId)
  if (!provider) return { ...base, message: '供应商已删除' }
  const key = openKey(provider.keyCipher)
  if (!key) return { ...base, message: '供应商没有可用 API Key' }

  const adapter = adapterFor(provider.format)
  const controller = new AbortController()
  active.set(modelId, controller)
  live.setProbing(modelId, true)
  live.begin(modelId)

  const started = Date.now()
  const usage: Usage = { ...EMPTY_USAGE }
  const run: Run = { status: 0, ok: false, ttftMs: null, tps: null, inputTokens: 0, outputTokens: 0 }

  try {
    // 连续点测速时先让开一点，减少自己触发限流
    const gap = lastFinished + MIN_GAP_MS - Date.now()
    if (gap > 0) await new Promise((r) => setTimeout(r, gap))

    const prepared = adapter.prepare(probeBody(), model.upstreamModel)
    const target = joinUrl(provider.baseUrl, `/v1/${provider.format === 'anthropic' ? 'messages' : 'chat/completions'}`)
    const send = (): Promise<Response> =>
      fetch(target, {
        method: 'POST',
        headers: { ...adapter.baseHeaders(), ...adapter.auth(key), 'accept-encoding': 'identity' },
        body: prepared.body,
        signal: controller.signal,
        redirect: 'follow'
      })

    // 429 多为速率限制：优先按 Retry-After 等待，没有就退避，最多重试两次
    const backoff = [2000, 6000]
    let res = await send()
    for (let i = 0; i < backoff.length && res.status === 429 && !controller.signal.aborted; i++) {
      const header = Number(res.headers.get('retry-after'))
      const waitMs = Number.isFinite(header) && header > 0 ? Math.min(header * 1000, 8000) : (backoff[i] ?? 4000)
      await new Promise((r) => setTimeout(r, waitMs))
      if (controller.signal.aborted) break
      res = await send()
    }
    run.status = res.status

    if (!res.ok) {
      const text = await res.text()
      const detail = adapter.errorOf(text) ?? text.slice(0, 200) ?? `HTTP ${res.status}`
      run.error =
        res.status === 429
          ? /\bTPM\b|EndpointTPM/i.test(detail)
            ? '上游端点 TPM 限流（token 额度已用满），等一分钟左右再测'
            : /Rpm|RPM/i.test(detail)
              ? '上游账号 RPM 限流，稍后再试'
              : `上游限流（429）：${detail}`
          : detail
      persist(model, provider, run, usage, started)
      return { ...base, status: run.status, error: run.error, message: run.error }
    }

    const tap = new SseTap()
    const reader = res.body?.getReader()
    if (!reader) throw new Error('上游没有返回响应体')

    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      for (const frame of tap.feed(Buffer.from(value))) {
        const info = adapter.onFrame(frame)
        if (info.firstContent && run.ttftMs === null) run.ttftMs = Date.now() - started
        live.noteDelta(model.id, info.cjk, info.other)
        if (info.usage) {
          Object.assign(usage, info.usage)
          Object.assign(usage, normalizeUsage(usage.input, usage.cacheRead, usage.cacheInput, usage.output))
        }
        if (info.error) run.error = info.error
      }
    }

    const duration = Date.now() - started
    run.ok = !run.error
    run.inputTokens = usage.input
    run.outputTokens = usage.output
    run.tps =
      run.ttftMs === null || usage.output <= 0
        ? null
        : usage.output / Math.max(0.001, (duration - run.ttftMs) / 1000)

    persist(model, provider, run, usage, started)

    if (!run.ok) return { ...base, status: run.status, error: run.error, message: run.error ?? '失败' }

    const message =
      run.tps === null
        ? `首字 ${run.ttftMs ?? '—'}ms，没有产生输出`
        : `首字 ${Math.round(run.ttftMs ?? 0)}ms · ${run.tps.toFixed(1)} tok/s`
    return {
      ...base,
      ok: true,
      status: run.status,
      ttftMs: run.ttftMs,
      tps: run.tps,
      inputTokens: run.inputTokens,
      outputTokens: run.outputTokens,
      message
    }
  } catch (err) {
    run.error = controller.signal.aborted ? '已停止' : err instanceof Error ? err.message : '请求失败'
    persist(model, provider, run, usage, started)
    return { ...base, status: run.status, error: run.error, message: run.error }
  } finally {
    active.delete(modelId)
    live.setProbing(modelId, false)
    live.end(modelId)
    lastFinished = Date.now()
  }
}
