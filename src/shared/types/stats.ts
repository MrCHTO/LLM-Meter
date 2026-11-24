/** 分析查询 */

export type StatsMetric =
  | 'requests'
  | 'errors'
  | 'input'
  | 'uncached'
  | 'output'
  | 'total'
  | 'cache_read'
  | 'cost'
  | 'tps'
export type StatsGranularity = 'minute' | 'hour' | 'day'
export type StatsGroup = 'model' | 'provider' | 'token'
export type StatsSource = 'all' | 'proxy' | 'probe'

export interface StatsQuery {
  from: number
  to: number
  source: StatsSource
}

export interface StatsSeriesQuery extends StatsQuery {
  granularity: StatsGranularity
  metric: StatsMetric
  groupBy: StatsGroup
}

export interface StatsSeries {
  buckets: number[]
  series: { key: string; label: string; points: number[] }[]
}

export interface StatsRow {
  key: string
  label: string
  requests: number
  errors: number
  input: number
  uncached: number
  output: number
  /** 输入 + 输出 */
  total: number
  cacheRead: number
  cacheInput: number
  cacheInputReported: number
  cacheReadReported: number
  cost: number
  ttftP50: number | null
  ttftP95: number | null
  ttftP99: number | null
  tps: number | null
}

export interface StatsExportResult {
  path: string
  rows: number
}
