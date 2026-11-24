/** 实时指标的状态模型与窗口常量 */

import type { TodayTotals } from '../../../shared/types'

export const BUCKETS = 180
export const RECENT_MAX = 200
/** tok/s 按 1 秒窗口：最近 1 秒桶里的输出 token 数 */
export const TPS_WINDOW = 1
/** 实时速率窗口：只看最近 2 秒的增量估算 */
export const DELTA_WINDOW_MS = 2000
/** 中文/英文每 token 的字符数默认值，会按完成请求的真实 usage 校正 */
export const COEF_CJK = 1.7
export const COEF_OTHER = 3.8
/** TTFT 分位数的样本上限，够估 P99 又不至于无限涨 */
export const TTFT_SAMPLES_MAX = 500

export interface ModelState {
  buckets: number[]
  /** 每秒请求数，供请求曲线用 */
  reqBuckets: number[]
  bucketSecond: number
  today: TodayTotals
  lastError: string | null
  lastErrorAt: number | null
  lastTtftMs: number | null
  lastTps: number | null
  lastTpsAt: number | null
  /** 今天的 TTFT 样本，重启时从明细回灌 */
  ttftSamples: number[]
  probing: boolean
  probeFails: number
  lastProbeAt: number | null
  lastProbeOk: boolean | null
  /** 流式增量样本，用于实时估算速率 */
  deltaSamples: { ts: number; tokens: number }[]
  /** 每秒估算 token，供多模型实时曲线 */
  deltaBuckets: number[]
  deltaSecond: number
  /** 当前生成开始时间；首字前为 null */
  genStart: number | null
  /** 本次生成累计的中英字符与默认估算量，结束后用于校正系数 */
  genCjk: number
  genOther: number
  genEst: number
  /** 已观察的真实输出 token 与真实字符，系数随完成请求收敛 */
  calibObs: number
  calibEst: number
}
