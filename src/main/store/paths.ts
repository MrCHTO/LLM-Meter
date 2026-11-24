import { app } from 'electron'
import { accessSync, constants, cpSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** 安装版把数据放在安装目录，dev/测试仍放 userData（测试靠临时档案隔离）。 */
let resolved: string | null = null

function userDataDir(): string {
  return join(app.getPath('userData'), 'data')
}

export function dataDir(): string {
  if (resolved) return resolved
  if (!app.isPackaged) {
    resolved = userDataDir()
    return resolved
  }
  const local = join(dirname(process.execPath), 'data')
  try {
    mkdirSync(local, { recursive: true })
    accessSync(local, constants.W_OK)
    resolved = local
  } catch {
    // 安装目录不可写时退回 userData，应用不至于起不来
    resolved = userDataDir()
  }
  return resolved
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

/** 从旧的 userData 数据目录搬一次家；失败就留原样，不阻塞启动。 */
function migrateFromUserData(target: string): void {
  const legacy = userDataDir()
  if (legacy === target) return
  if (existsSync(join(target, 'config.json')) || existsSync(join(target, 'llm-meter.db'))) return
  if (!existsSync(legacy)) return
  try {
    cpSync(legacy, target, { recursive: true })
  } catch {
    /* 原始数据仍在 userData 下，下次启动会再试 */
  }
}

/** 只建数据根目录；events/rollup 是旧版目录，导入后会改名，不再预先重建。 */
export function ensureDirs(): void {
  const dir = dataDir()
  mkdirSync(dir, { recursive: true })
  if (app.isPackaged) migrateFromUserData(dir)
}

/** 本地日期，用于文件名分片：YYYY-MM-DD */
export function dayKey(ts = Date.now()): string {
  const d = new Date(ts)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
