import * as cfg from '../store/config'
import { open as openKey } from '../security/keys'
import { adapterFor } from '../proxy/adapters'
import { joinUrl } from '../proxy/url'
import { lookup as lookupPrice } from '../pricing'
import * as rate from '../rate'
import type { PriceLookupResult } from '../../shared/ipc/contract'

/** 探测一次上游 usage 是否带缓存写入字段，决定界面是否允许填写入价 */
async function probeCacheWrite(modelId: string, providerId?: string): Promise<{ probed: boolean; reported: boolean }> {
  if (!providerId) return { probed: false, reported: false }
  const p = cfg.providerById(providerId)
  if (!p) return { probed: false, reported: false }
  const key = openKey(p.keyCipher)
  if (!key) return { probed: false, reported: false }
  const adapter = adapterFor(p.format)
  const prepared = adapter.prepare(
    { model: modelId, messages: [{ role: 'user', content: 'hi' }], max_tokens: 1, stream: false },
    modelId
  )
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15_000)
  try {
    const res = await fetch(joinUrl(p.baseUrl, `/v1/${p.format === 'anthropic' ? 'messages' : 'chat/completions'}`), {
      method: 'POST',
      headers: { ...adapter.baseHeaders(), ...adapter.auth(key) },
      body: prepared.body,
      signal: controller.signal
    })
    if (!res.ok) return { probed: false, reported: false }
    const parsed = adapter.parseUsage(await res.text())
    return { probed: true, reported: parsed?.reportedCacheInput === true }
  } catch {
    return { probed: false, reported: false }
  } finally {
    clearTimeout(timer)
  }
}

/** 查价并把结果折算成人民币，同时带上缓存写入能力的探测结论 */
export async function quote(modelId: string, providerId?: string): Promise<PriceLookupResult> {
  const [out, capability] = await Promise.all([lookupPrice(modelId), probeCacheWrite(modelId, providerId)])
  const cached = { cacheWriteProbed: capability.probed, cacheWriteReported: capability.reported }
  if (!out.found) return { ...out, ...cached }
  // 价源报的是美元，按当天汇率折成人民币再给界面
  const today = await rate.current()
  const conv = (v?: number): number | undefined =>
    v === undefined ? undefined : Math.round(v * today.rate * 1e6) / 1e6
  return {
    ...out,
    ...cached,
    priceIn: conv(out.priceIn),
    priceOut: conv(out.priceOut),
    priceCacheRead: conv(out.priceCacheRead),
    priceCacheInput: conv(out.priceCacheInput),
    note: `已按照 ${out.matchedId} 查询并自动填写${
      out.source === 'official' ? '（官方价）' : '（OpenRouter 最低服务商价）'
    }，人民币汇率为 ${today.rate.toFixed(2)}${out.exact ? '' : '（近似匹配，请核对）'}`
  }
}
