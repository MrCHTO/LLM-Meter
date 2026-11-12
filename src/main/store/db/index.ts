import { join } from 'node:path'
import * as cfg from '../config'
import { dataDir, ensureDirs } from '../paths'
import { open, type Db } from './driver'
import { ensureMeta, migrate } from './schema'
import { alreadyImported, importLegacy } from './import'
import { prune } from './repo'

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

  if (!alreadyImported(conn)) {
    try {
      const out = importLegacy(conn, dataDir())
      console.log(`[db] 旧数据导入完成：请求 ${out.requests} 条、分钟桶 ${out.minutes} 条`)
    } catch (err) {
      console.error('[db] 旧数据导入失败，下次启动重试', err)
    }
  }

  runPrune()
  if (pruneTimer) clearInterval(pruneTimer)
  pruneTimer = setInterval(runPrune, 60 * 60_000)
  pruneTimer.unref?.()
}

/** 每小时看一次，只在 04 点之后跑一次当天清理 */
function runPrune(): void {
  const settings = cfg.get().settings
  const today = dayKeyNow()
  const hour = new Date().getHours()
  if (lastPruneDay === `${today}-${hour}`) return
  if (lastPruneDay === today && hour < 4) return
  lastPruneDay = hour >= 4 ? today : `${today}-${hour}`
  try {
    const out = prune(get(), Date.now(), settings.retentionDays, settings.rollupRetentionDays)
    if (out.requests) console.log(`[db] 清理过期明细 ${out.requests} 条`)
  } catch (err) {
    console.error('[db] 清理失败', err)
  }
}

function dayKeyNow(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function close(): void {
  if (pruneTimer) clearInterval(pruneTimer)
  pruneTimer = null
  conn?.close()
  conn = null
}
