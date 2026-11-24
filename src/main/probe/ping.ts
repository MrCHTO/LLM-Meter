import { randomUUID } from 'node:crypto'
import type { RequestEvent } from '../../shared/types'
import * as cfg from '../store/config'
import * as db from '../store/db'
import * as repo from '../store/db/repo'
import * as live from '../store/live'
import { dayKey } from '../store/paths'
import { open as openKey } from '../security/keys'
import { joinUrl } from '../proxy/url'

const TIMEOUT_MS = 15_000

/**
 * 自动探活：极轻请求（max_tokens 1、非流式），只看 HTTP 状态。
 * 思考模型在小预算下可能没有可见输出，200 仍算存活。
 */
export async function ping(modelId: string): Promise<boolean> {
  const model = cfg.modelById(modelId)
  if (!model) return false
  const provider = cfg.providerById(model.providerId)
  const key = provider ? openKey(provider.keyCipher) : ''

  const started = Date.now()
  let status = 0
  let ok = false
  let note = '自动探活'
  live.begin(modelId)
  try {
    if (!provider || !provider.enabled || !key) {
      note = '自动探活：供应商不可用'
      return false
    }
    const headers: Record<string, string> =
      provider.format === 'anthropic'
        ? { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }
        : { authorization: `Bearer ${key}`, 'content-type': 'application/json' }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    try {
      const res = await fetch(
        joinUrl(provider.baseUrl, provider.format === 'anthropic' ? '/v1/messages' : '/v1/chat/completions'),
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model: model.upstreamModel,
            max_tokens: 1,
            messages: [{ role: 'user', content: 'hi' }]
          }),
          signal: controller.signal
        }
      )
      status = res.status
      ok = res.ok
      await res.text().catch(() => '')
    } catch (err) {
      note = `自动探活：${(err as Error).name === 'AbortError' ? '超时' : '网络失败'}`
    } finally {
      clearTimeout(timer)
    }
  } finally {
    live.end(modelId)
  }

  live.markProbe(modelId, ok)
  const ev: RequestEvent = {
    id: randomUUID(),
    ts: started,
    source: 'probe',
    modelId,
    alias: model.alias,
    providerId: model.providerId,
    status,
    ok,
    errorKind: ok ? null : status ? 'upstream_4xx' : 'network',
    stream: false,
    ttftMs: null,
    durationMs: Date.now() - started,
    inputTokens: 0,
    uncachedInputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheInputTokens: 0,
    cacheInputReported: false,
    cacheReadReported: false,
    cost: 0,
    currency: 'CNY',
    note
  }
  live.record(ev)
  try {
    repo.recordRequest(db.get(), ev, {
      day: dayKey(ev.ts),
      providerName: provider?.name ?? '',
      baseUrl: provider?.baseUrl ?? '',
      upstreamModel: model.upstreamModel,
      priceIn: model.priceIn,
      priceOut: model.priceOut,
      priceCacheRead: model.priceCacheRead,
      priceCacheInput: model.priceCacheInput
    })
  } catch {
    /* 落库失败不影响探活结果 */
  }
  return ok
}
