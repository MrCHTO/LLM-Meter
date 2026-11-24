/** 请求明细 */

export type RequestSource = 'proxy' | 'probe'

export type ErrorKind =
  | 'auth'
  | 'not_found'
  | 'model_disabled'
  | 'timeout'
  | 'aborted'
  | 'upstream_4xx'
  | 'upstream_5xx'
  | 'network'
  | 'parse'
  | 'unsupported'

/** 一次请求的落盘形态 */
export interface RequestEvent {
  id: string
  ts: number
  source: RequestSource
  modelId: string
  alias: string
  providerId: string
  status: number
  ok: boolean
  errorKind: ErrorKind | null
  stream: boolean
  /** 首个有效内容帧耗时；非流式为 null */
  ttftMs: number | null
  durationMs: number
  inputTokens: number
  /** 输入中未命中缓存、按输入原价计费的部分 */
  uncachedInputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheInputTokens: number
  /** 上游是否上报了缓存输入字段；false 时界面显示 — */
  cacheInputReported: boolean
  /** 上游是否上报了缓存读计数；false 时命中率与缓存读列显示 — */
  cacheReadReported: boolean
  cost: number
  currency: string
  /** 仅内存，给明细列表用；不落盘 */
  note?: string
}

/** 日志页的请求行：请求明细 + 当时的供应商名与上游模型 */
export interface RequestLog extends RequestEvent {
  providerName: string
  upstreamModel: string
}

export interface TodayTotals {
  requests: number
  errors: number
  input: number
  uncachedInput: number
  output: number
  cacheRead: number
  cacheInput: number
  /** 本周期内上报过缓存输入字段的请求数；为 0 时显示 — */
  cacheInputReported: number
  /** 本周期内上报过缓存读计数的请求数；为 0 时命中率显示 — */
  cacheReadReported: number
  cost: number
}

export interface DayPoint {
  ts: number
  out: number
  req: number
  err: number
  cost: number
}
