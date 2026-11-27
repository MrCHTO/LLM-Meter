/** 日志查询 */

import type { RequestSource } from './request'

export type AppLogLevel = 'info' | 'warn' | 'error'

/** 运行日志一行 */
export interface AppLog {
  id: string
  ts: number
  level: AppLogLevel
  scope: string
  message: string
}

export interface LogQuery {
  from: number
  to: number
  /** 请求日志专用 */
  modelId?: string
  source?: RequestSource
  ok?: boolean
  /** 两种日志共用 */
  keyword?: string
  level?: AppLogLevel
  page: number
  pageSize: number
}

export interface LogPage<T> {
  rows: T[]
  total: number
}
