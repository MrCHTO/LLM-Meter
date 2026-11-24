import { join } from 'node:path'
import * as applog from '../../applog'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, renameSync } from 'node:fs'
import * as cfg from '../config'
import { dataDir, ensureDirs } from '../paths'
import { dayKey } from '../../../shared/date'
import { open, type Db } from './driver'
import { ensureMeta, migrate } from './schema'
import { alreadyImported, importLegacy } from './import'
import { insertAppLog, prune } from './repo'

let conn: Db | null = null
let pruneTimer: NodeJS.Timeout | null = null
let lastPruneDay = ''

function dbFile(): string {
  return join(dataDir(), 'llm-meter.db')
}

export function get(): Db {
  if (!conn) throw new Error('数据库尚未初始化')
  return conn
}

export function init(): void {
  ensureDirs()
  conn = open(dbFile())
  ensureMeta(conn)
  migrate(conn)
  importCalibrateLog(conn)

  if (!alreadyImported(conn)) {
    try {
      const out = importLegacy(conn, dataDir())
      applog.info('db', `旧数据导入完成：请求 ${out.requests} 条、分钟桶 ${out.minutes} 条`)
    } catch (err) {
      applog.error('db', `旧数据导入失败，下次启动重试：${err instanceof Error ? err.message : String(err)}`)
    }
  }

  runPrune()
  if (pruneTimer) clearInterval(pruneTimer)
  pruneTimer = setInterval(runPrune, 60 * 60_000)
  pruneTimer.unref?.()
}

/** 旧版 calibrate.log 一次性搬进运行日志表，搬完改名留档 */
function importCalibrateLog(conn: Db): void {
  const file = join(dataDir(), 'calibrate.log')
  if (!existsSync(file)) return
  try {
    const lines = readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean)
    conn.tx(() => {
      for (const line of lines) {
        const match = /^(\S+)\s+(.*)$/.exec(line)
        const ts = match ? Date.parse(match[1] as string) : Number.NaN
        insertAppLog(
          conn,
          randomUUID(),
          Number.isNaN(ts) ? Date.now() : ts,
          'info',
          'calibrate',
          match ? (match[2] as string) : line
        )
      }
    })
    renameSync(file, `${file}.imported`)
  } catch (err) {
    applog.error('db', `calibrate.log 迁移失败：${err instanceof Error ? err.message : String(err)}`)
  }
}

/** 每小时看一次，只在 04 点之后跑一次当天清理 */
function runPrune(): void {
  const settings = cfg.get().settings
  const today = dayKey()
  const hour = new Date().getHours()
  if (lastPruneDay === `${today}-${hour}`) return
  if (lastPruneDay === today && hour < 4) return
  lastPruneDay = hour >= 4 ? today : `${today}-${hour}`
  try {
    const out = prune(get(), Date.now(), settings.retentionDays, settings.rollupRetentionDays)
    if (out.requests) applog.info('db', `清理过期明细 ${out.requests} 条`)
  } catch (err) {
    applog.error('db', `清理失败：${err instanceof Error ? err.message : String(err)}`)
  }
}


export function close(): void {
  if (pruneTimer) clearInterval(pruneTimer)
  pruneTimer = null
  conn?.close()
  conn = null
}
