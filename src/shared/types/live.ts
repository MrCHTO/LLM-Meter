/** 实时快照（主进程推给界面） */

import type { ApiFormat, OverlayState } from './config'
import type { TodayTotals } from './request'

export interface ModelLive {
  modelId: string
  alias: string
  providerName: string
  /** 上游根地址，界面直接展示 */
  baseUrl: string
  /** 真正发给上游的模型名 */
  upstreamModel: string
  format: ApiFormat
  currency: string
  watch: boolean
  showRate: boolean
  buckets: number[]
  /** 每秒增量估算 token，供多模型实时曲线；估算值，不参与统计与计费 */
  deltaBuckets: number[]
  tps: number
  /** 首字后按增量估算的实时速率；首字前为 null */
  realtimeTps: number | null
  /** 今日缓存命中率，无输入 token 时为 null */
  hitRate: number | null
  today: TodayTotals
  lastError: string | null
  lastErrorAt: number | null
  lastTtftMs: number | null
  /** 最近一次成功请求的生成速率（tok/s）与时间 */
  lastTps: number | null
  lastTpsAt: number | null
  /** 今天的 TTFT 分位数（毫秒），无样本为 null */
  ttftP50: number | null
  ttftP95: number | null
  ttftP99: number | null
  /** 正在进行的请求数 */
  inflight: number
  /** 是否该显示流光：进行中，或开始后不足 1.5 秒 */
  active: boolean
  probing: boolean
  /** 自动探活开关与最近结果 */
  autoProbe: boolean
  lastProbeAt: number | null
  lastProbeOk: boolean | null
  probeFails: number
}

export interface SnapshotTotals {
  tps: number
  hitRate: number | null
  todayCost: number
  requests: number
  errors: number
  currency: string
  /** 各模型桶按秒相加，给汇总曲线用 */
  buckets: number[]
  /** 每秒请求数 */
  reqBuckets: number[]
}

export interface LiveSnapshot {
  ts: number
  proxyRunning: boolean
  proxyError: string | null
  baseUrl: string
  models: ModelLive[]
  totals: SnapshotTotals
  /** 胶囊盯住的模型，随每次推送带下去 */
  overlayModelId: string | null
  /** 悬浮窗外观与交互状态 */
  overlay: OverlayState
}
