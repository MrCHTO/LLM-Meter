import { randomUUID } from 'node:crypto'
import * as db from './store/db'

export type LogLevel = 'info' | 'warn' | 'error'

/**
 * 运行日志：落库供日志页查看，同时打一份到控制台。
 * 数据库没初始化或已关闭时只打控制台，不影响主流程。
 */
export function write(level: LogLevel, scope: string, message: string): void {
  try {
    db.get().run(
      'insert into app_logs (id, ts, level, scope, message) values (?, ?, ?, ?, ?)',
      randomUUID(),
      Date.now(),
      level,
      scope,
      message
    )
  } catch {
    /* 库不可用就只留控制台 */
  }
  const line = `[${scope}] ${message}`
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

export const info = (scope: string, message: string): void => write('info', scope, message)
export const warn = (scope: string, message: string): void => write('warn', scope, message)
export const error = (scope: string, message: string): void => write('error', scope, message)
