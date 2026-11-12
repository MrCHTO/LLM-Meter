import { randomUUID } from 'node:crypto'
import type { ProbeResult, RequestEvent } from '../../shared/types'
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
const FILLER = '温度、气压与湿度沿着海岸线缓慢变化，The quick brown fox jumps over the lazy dog。'

const active = new Map<string, AbortController>()

/** 只测速度：一次请求，看首字与生成速率，不比对缓存。 */
function probeBody(): Record<string, unknown> {
  return {
    messages: [
      {
        role: 'user',
        content: `请用中文写一段约 400 字的说明，介绍沿海气候的特点。${FILLER}`
      }
    ],
    max_tokens: 320,
    temperature: 0,
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

function persist(
  modelId: string,
  alias: string,
  providerId: string,
  currency: string,
  run: Run,
  usage: Usage,
  modelPrices: Parameters<typeof cost>[0],
  started: number
): void {
  const ev: RequestEvent = {
    id: randomUUID(),
    ts: Date.now(),
    source: 'probe',
    modelId,
    alias,
    providerId,
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
    cost: run.ok ? cost(modelPrices, usage) : 0,
    currency,
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
  if (cfg.get().settings.pauseProbe) return { ...base, message: '测速已暂停，右键悬浮窗或到设置里恢复' }
  if (active.has(modelId)) return { ...base, message: '该模型正在测速' }

  const provider = cfg.providerById(model.providerId)
  if (!provider) return { ...base, message: '供应商已删除' }
  const key = openKey(provider.keyCipher)
  if (!key) return { ...base, message: '供应商没有可用 API Key' }

  const adapter = adapterFor(provider.format)
  const controller = new AbortController()
  active.set(modelId, controller)
  live.setProbing(modelId, true)

  const started = Date.now()
  const usage: Usage = { ...EMPTY_USAGE }
  const run: Run = { status: 0, ok: false, ttftMs: null, tps: null, inputTokens: 0, outputTokens: 0 }

  try {
    const prepared = adapter.prepare(probeBody(), model.upstreamModel)
    const res = await fetch(
      joinUrl(provider.baseUrl, `/v1/${provider.format === 'anthropic' ? 'messages' : 'chat/completions'}`),
      {
        method: 'POST',
        headers: { ...adapter.baseHeaders(), ...adapter.auth(key), 'accept-encoding': 'identity' },
        body: prepared.body,
        signal: controller.signal,
        redirect: 'follow'
      }
    )
    run.status = res.status

    if (!res.ok) {
      const text = await res.text()
      run.error = adapter.errorOf(text) ?? text.slice(0, 200) ?? `HTTP ${res.status}`
      persist(modelId, model.alias, provider.id, model.currency, run, usage, model, started)
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
        if (info.usage) Object.assign(usage, info.usage)
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

    persist(modelId, model.alias, provider.id, model.currency, run, usage, model, started)

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
    persist(modelId, model.alias, provider.id, model.currency, run, usage, model, started)
    return { ...base, status: run.status, error: run.error, message: run.error }
  } finally {
    active.delete(modelId)
    live.setProbing(modelId, false)
  }
}
