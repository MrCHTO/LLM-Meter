/**
 * 日期与时间工具。本地日期键（YYYY-MM-DD）统一从这里取，别在业务里手拼 padStart。
 */

export function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** 本地日期键，用于分片、聚合与文件名 */
export function dateKey(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

export function dayKey(ts = Date.now()): string {
  return dateKey(new Date(ts))
}

/** 本地当天 0 点的时间戳 */
export function dayStart(ts: number): number {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** 时分秒，日志与明细列表用 */
export function fmtClock(ts: number): string {
  const d = new Date(ts)
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
}
