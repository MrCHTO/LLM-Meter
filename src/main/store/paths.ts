import { app } from 'electron'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'

/** 所有落盘都在 userData 下，dev 与安装版共用一份，便于调试。 */
export function dataDir(): string {
  return join(app.getPath('userData'), 'data')
}

export function eventsDir(): string {
  return join(dataDir(), 'events')
}

export function rollupDir(): string {
  return join(dataDir(), 'rollup')
}

export function configPath(): string {
  return join(dataDir(), 'config.json')
}

export function ensureDirs(): void {
  for (const d of [dataDir(), eventsDir(), rollupDir()]) {
    mkdirSync(d, { recursive: true })
  }
}

/** 本地日期，用于文件名分片：YYYY-MM-DD */
export function dayKey(ts = Date.now()): string {
  const d = new Date(ts)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
