import type { RequestEvent } from '../../../../shared/types'

export interface RecentRow {
  id: string
  ts: number
  source: string
  status: number
  ok: number
  error_kind: string | null
  stream: number
  ttft_ms: number | null
  duration_ms: number
  input_tokens: number
  uncached_input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_input_tokens: number
  cache_input_reported: number
  cache_read_reported: number
  cost: number
  currency: string
  model_id: string
  alias: string
  provider_id: string
  note: string | null
  token_id?: string | null
  token_remark?: string | null
}

/** 数据库行 → 请求事件。最近、回放与日志三处共用，别再各抄一份 */
export function toEvent(r: RecentRow): RequestEvent {
  return {
    id: r.id,
    ts: r.ts,
    source: r.source === 'probe' ? 'probe' : 'proxy',
    modelId: r.model_id,
    alias: r.alias,
    providerId: r.provider_id,
    status: r.status,
    ok: r.ok === 1,
    errorKind: (r.error_kind as RequestEvent['errorKind']) ?? null,
    stream: r.stream === 1,
    ttftMs: r.ttft_ms,
    durationMs: r.duration_ms,
    inputTokens: r.input_tokens,
    uncachedInputTokens: r.uncached_input_tokens,
    outputTokens: r.output_tokens,
    cacheReadTokens: r.cache_read_tokens,
    cacheInputTokens: r.cache_input_tokens,
    cacheInputReported: r.cache_input_reported === 1,
    cacheReadReported: r.cache_read_reported === 1,
    cost: r.cost,
    currency: r.currency,
    note: r.note ?? undefined
  }
}
