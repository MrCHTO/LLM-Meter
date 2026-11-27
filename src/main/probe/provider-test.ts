import type { ProviderTestResult } from '../../shared/types'
import * as cfg from '../store/config'
import { open as openKey } from '../security/keys'
import { joinUrl } from '../proxy/url'
import { readable } from '../ipc/shared'

/** 用 /v1/models 探供应连通性与 Key 是否可读；404 视为连通（站点没有该端点） */
export async function testProvider(id: string): Promise<ProviderTestResult> {
  const p = cfg.providerById(id)
  if (!p) throw new Error('供应商不存在')
  const key = openKey(p.keyCipher)
  if (!key) throw new Error('先填 API Key')
  const headers: Record<string, string> =
    p.format === 'anthropic'
      ? { 'x-api-key': key, 'anthropic-version': '2023-06-01' }
      : { authorization: `Bearer ${key}` }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 20_000)
  try {
    // Base URL 可能已经写到 /v1，交给 joinUrl 去重
    const res = await fetch(joinUrl(p.baseUrl, '/v1/models'), { headers, signal: controller.signal })
    const text = await res.text()
    let message = res.ok ? '连通，Key 可读' : readable(text, res.status)
    if (res.status === 401 || res.status === 403) message = 'Key 被拒绝'
    else if (res.status === 404) message = '连通，但该站没有 /v1/models（不影响使用）'
    return { ok: res.ok || res.status === 404, status: res.status, message }
  } catch (err) {
    return {
      ok: false,
      status: 0,
      message: controller.signal.aborted ? '超时' : err instanceof Error ? err.message : '连接失败'
    }
  } finally {
    clearTimeout(timer)
  }
}
