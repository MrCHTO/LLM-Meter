/** IPC 注册的公共工具：统一返回形态、异常兜底与按契约注册 */

import { ipcMain } from 'electron'
import { channelOf, type IpcMethods } from '../../shared/ipc/contract'
import type { IpcResult, LogQuery } from '../../shared/types'

export function ok<T>(data?: T): IpcResult<T> {
  return { ok: true, data }
}

export function bad(error: string): IpcResult<never> {
  return { ok: false, error }
}

export function wrap<A extends unknown[], T>(fn: (...args: A) => T | Promise<T>) {
  return async (_e: Electron.IpcMainInvokeEvent, ...args: A): Promise<IpcResult<T>> => {
    try {
      return ok(await fn(...args))
    } catch (err) {
      console.error('[ipc]', err)
      return bad(err instanceof Error ? err.message : '操作失败')
    }
  }
}

/** 按契约注册：方法名决定通道，入参与返回值由 IpcMethods 校验 */
export function handle<M extends keyof IpcMethods>(
  method: M,
  fn: (e: Electron.IpcMainInvokeEvent, ...args: IpcMethods[M]['args']) => Promise<IpcResult<IpcMethods[M]['result']>>
): void {
  ipcMain.handle(channelOf(method), fn)
}

/** 日志页查询参数归一：时间窗必填，分页限幅，关键字截断 */
export function logQuery(input: LogQuery | undefined): LogQuery {
  const q = input ?? ({} as LogQuery)
  const pageSize = Math.min(Math.max(Math.round(q.pageSize) || 100, 1), 200)
  const page = Math.max(Math.round(q.page) || 1, 1)
  const to = Number(q.to) || Date.now()
  const from = Number(q.from) || to - 24 * 3_600_000
  return {
    from: Math.min(from, to),
    to,
    modelId: q.modelId || undefined,
    source: q.source === 'probe' || q.source === 'proxy' ? q.source : undefined,
    ok: typeof q.ok === 'boolean' ? q.ok : undefined,
    keyword: (q.keyword ?? '').slice(0, 100),
    level: q.level === 'warn' || q.level === 'error' ? q.level : q.level === 'info' ? 'info' : undefined,
    page,
    pageSize
  }
}

/** 上游错误体通常是 JSON，取里面的 message，取不到就退回原文 */
export function readable(text: string, status: number): string {
  try {
    const parsed = JSON.parse(text) as { error?: { message?: unknown }; message?: unknown }
    const msg = parsed.error?.message ?? parsed.message
    if (typeof msg === 'string' && msg) return msg
  } catch {
    /* 不是 JSON */
  }
  return text.slice(0, 200) || `HTTP ${status}`
}
