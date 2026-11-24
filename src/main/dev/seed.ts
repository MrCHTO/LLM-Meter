import type { RequestEvent } from '../../shared/types'
import { dayKey } from '../../shared/date'
import * as cfg from '../store/config'
import * as db from '../store/db'
import * as repo from '../store/db/repo'

/** 造 count 条近 6 小时的假请求，写进明细与聚合 */
export function seed(count: number): number {
  const models = cfg.listModels().filter((m) => m.enabled)
  if (models.length === 0) throw new Error('先配置模型')
  const now = Date.now()
  let made = 0
  for (let i = 0; i < count; i++) {
    const model = models[i % models.length]
    if (!model) continue
    const provider = cfg.providerById(model.providerId)
    if (!provider) continue
    const ts = now - Math.floor((i / count) * 6 * 3_600_000) - Math.floor(Math.random() * 30_000)
    const input = 400 + Math.floor(Math.random() * 3000)
    const output = 40 + Math.floor(Math.random() * 500)
    const cacheRead = Math.floor(input * (Math.random() * 0.9))
    const duration = 600 + Math.floor(Math.random() * 4000)
    const ev: RequestEvent = {
      id: `seed-${ts}-${i}`,
      ts,
      source: Math.random() < 0.15 ? 'probe' : 'proxy',
      modelId: model.id,
      alias: model.alias,
      providerId: provider.id,
      status: 200,
      ok: true,
      errorKind: null,
      stream: true,
      ttftMs: 120 + Math.floor(Math.random() * 900),
      durationMs: duration,
      inputTokens: input,
      uncachedInputTokens: Math.max(0, input - cacheRead),
      outputTokens: output,
      cacheReadTokens: cacheRead,
      cacheInputTokens: 0,
      cacheInputReported: false,
      cacheReadReported: cacheRead > 0,
      cost:
        (Math.max(0, input - cacheRead) * model.priceIn + output * model.priceOut + cacheRead * model.priceCacheRead) /
        1e6,
      currency: model.currency
    }
    repo.recordRequest(db.get(), ev, {
      day: dayKey(ts),
      providerName: provider.name,
      baseUrl: provider.baseUrl,
      upstreamModel: model.upstreamModel,
      priceIn: model.priceIn,
      priceOut: model.priceOut,
      priceCacheRead: model.priceCacheRead,
      priceCacheInput: model.priceCacheInput
    })
    made++
  }
  return made
}
