import { randomUUID } from 'node:crypto'
import type { ApiFormat, ModelCfg, ProbeResult, ProbeRun, Provider, RequestEvent } from '../../shared/types'
import * as cfg from '../store/config'
import * as live from '../store/live'
import * as rollup from '../store/rollup'
import * as events from '../store/events'
import { open as openKey } from '../security/keys'
import { adapterFor } from './../proxy/adapters'
import { SseTap } from '../proxy/sse'
import { joinUrl } from '../proxy/url'
import { cost, EMPTY_USAGE, type Usage } from '../metrics/cost'

const TIMEOUT_MS = 120_000
/** 约 2600 token 的稳定前缀，超过两家的自动缓存门槛 */
const FILLER = '缓存前缀用于测量命中。The quick brown fox jumps over the lazy dog. 温度、气压与湿度沿着海岸线缓慢变化，'
const PREFIX_TOKENS = 300

const active = new Map<string, AbortController>()

function buildPrefix(runId: string): string {
  const parts: string[] = [`probe-run:${runId}`]
  for (let i = 0; i < PREFIX_TOKENS; i++) parts.push(`${i} ${FILLER}`)
  return parts.join(' ')
}

function bodyFor(format: ApiFormat, prefix: string): Record<string, unknown> {
  const ask = '请用中文写一段约 200 字的说明，介绍你自己擅长什么。'
  if (format === 'anthropic') {
    return {
      system: prefix,
      messages: [{ role: 'user', content: ask }],
      max_tokens: 400,
      temperature: 0,
      stream: true
    }
  }
  return {
    messages: [
      { role: 'system', content: prefix },
      { role: 'user', content: ask }
    ],
    max_tokens: 400,
    temperature: 0,
    stream: true,
    stream_options: { include_usage: true }
  }
}

async function once(
  model: ModelCfg,
  provider: Provider,
  prefix: string,
  signal: AbortSignal
): Promise<{ run: ProbeRun; usage: Usage }> {
  const adapter = adapterFor(provider.format)
  const key = openKey(provider.keyCipher)
  const started = Date.now()
  const usage: Usage = { ...EMPTY_USAGE }
  const run: ProbeRun = {
    status: 0,
    ok: false,
    ttftMs: null,
    tps: null,
    inputTokens: 0,
    cacheReadTokens: 0,
    outputTokens: 0
  }

  if (!key) {
    run.error = '供应商没有可用 API Key'
    return { run, usage }
  }

  const prepared = adapter.prepare(bodyFor(provider.format, prefix), model.upstreamModel)
  const headers: Record<string, string> = {
    ...adapter.baseHeaders(),
    ...adapter.auth(key),
    'accept-encoding': 'identity'
  }

  try {
    const res = await fetch(
      joinUrl(provider.baseUrl, `/v1/${provider.format === 'anthropic' ? 'messages' : 'chat/completions'}`),
      {
        method: 'POST',
        headers,
        body: prepared.body,
        signal,
        redirect: 'follow'
      }
    )
    run.status = res.status
    if (!res.ok) {
      const text = await res.text()
      run.error = adapter.errorOf(text) ?? text.slice(0, 200) ?? `HTTP ${res.status}`
      return { run, usage }
    }

    const tap = new SseTap()
    const reader = res.body?.getReader()
    if (!reader) {
      run.error = '没有响应体'
      return { run, usage }
    }
    let chars = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      for (const frame of tap.feed(Buffer.from(value))) {
        const info = adapter.onFrame(frame)
        chars += info.chars
        if (info.firstContent && run.ttftMs === null) run.ttftMs = Date.now() - started
        if (info.usage) Object.assign(usage, info.usage)
        if (info.error) run.error = info.error
      }
    }

    if (usage.output === 0 && chars > 0) usage.output = Math.max(1, Math.round(chars / 4))
    const duration = Date.now() - started
    run.ok = !run.error
    run.inputTokens = usage.input
    run.cacheReadTokens = usage.cacheRead
    run.outputTokens = usage.output
    run.tps =
      run.ttftMs === null || usage.output <= 0
        ? null
        : usage.output / Math.max(0.001, (duration - run.ttftMs) / 1000)
    return { run, usage }
  } catch (err) {
    run.error = signal.aborted ? '已停止' : err instanceof Error ? err.message : '请求失败'
    return { run, usage }
  }
}

function persist(model: ModelCfg, provider: Provider, run: ProbeRun, usage: Usage, started: number): void {
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
    outputTokens: usage.output,
    cacheReadTokens: usage.cacheRead,
    cacheWriteTokens: usage.cacheWrite,
    cost: run.ok ? cost(model, usage) : 0,
    currency: model.currency,
    note: run.error
  }
  live.record(ev)
  rollup.add(ev)
  events.append(ev)
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
  const model = cfg.modelById(modelId)
  const blank: ProbeResult = {
    modelId,
    alias: model?.alias ?? modelId,
    ok: false,
    cold: { status: 0, ok: false, ttftMs: null, tps: null, inputTokens: 0, cacheReadTokens: 0, outputTokens: 0 },
    warm: { status: 0, ok: false, ttftMs: null, tps: null, inputTokens: 0, cacheReadTokens: 0, outputTokens: 0 },
    cacheEffective: false,
    message: ''
  }
  if (!model) return { ...blank, message: '模型不存在' }
  if (cfg.get().settings.pauseProbe) return { ...blank, message: '探针已暂停，右键悬浮窗或到设置里恢复' }
  if (active.has(modelId)) return { ...blank, message: '该模型正在测速' }
  const provider = cfg.providerById(model.providerId)
  if (!provider) return { ...blank, message: '供应商已删除' }

  const controller = new AbortController()
  active.set(modelId, controller)
  live.setProbing(modelId, true)
  const started = Date.now()

  try {
    const prefix = buildPrefix(randomUUID())
    const cold = await once(model, provider, prefix, controller.signal)
    persist(model, provider, cold.run, cold.usage, started)

    let warm: { run: ProbeRun; usage: Usage } = {
      run: { ...cold.run },
      usage: { ...cold.usage }
    }
    if (cold.run.ok && !controller.signal.aborted) {
      // 同一前缀再来一次；第二次的 cache_read 就是缓存是否生效的答案
      warm = await once(model, provider, prefix, controller.signal)
      persist(model, provider, warm.run, warm.usage, Date.now())
    }

    const offset = warm.usage.cacheRead - cold.usage.cacheRead
    const cacheEffective = warm.usage.cacheRead > 0 && offset > 0
    let message: string
    if (!cold.run.ok) message = `冷请求失败：${cold.run.error ?? '未知'}`
    else if (warm.run.cacheReadTokens === 0) message = '缓存未生效：二次请求的缓存读为 0'
    else if (!cacheEffective) message = `二次请求读缓存 ${warm.run.cacheReadTokens}，但未超过首次`
    else message = `缓存有效：第二次多读到 ${offset} 个缓存 token`

    return {
      modelId,
      alias: model.alias,
      ok: cold.run.ok && warm.run.ok,
      cold: cold.run,
      warm: warm.run,
      cacheEffective,
      message
    }
  } finally {
    active.delete(modelId)
    live.setProbing(modelId, false)
  }
}
