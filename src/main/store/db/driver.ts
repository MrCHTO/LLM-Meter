import { createRequire } from 'node:module'
import type { DatabaseSync as DatabaseSyncType, StatementSync } from 'node:sqlite'

/**
 * 用 createRequire 拿驱动：vite 5 的内置模块表还没有 node:sqlite，
 * 走 require 可以绕开打包器的解析；类型仍从 node:sqlite 引入（仅类型，编译后擦除）。
 */
const require = createRequire(import.meta.url)
const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: typeof DatabaseSyncType }

export type SqlValue = string | number | bigint | null | Uint8Array
type Row = Record<string, SqlValue>

/**
 * 只暴露仓库层需要的最小面。换驱动（例如 better-sqlite3）只改这个文件。
 */
export class Db {
  private stmts = new Map<string, StatementSync>()

  constructor(private readonly raw: DatabaseSyncType) {}

  exec(sql: string): void {
    this.raw.exec(sql)
  }

  private stmt(sql: string): StatementSync {
    const found = this.stmts.get(sql)
    if (found) return found
    const created = this.raw.prepare(sql)
    this.stmts.set(sql, created)
    return created
  }

  all<T = Row>(sql: string, ...params: SqlValue[]): T[] {
    return this.stmt(sql).all(...params) as T[]
  }

  get<T = Row>(sql: string, ...params: SqlValue[]): T | undefined {
    return this.stmt(sql).get(...params) as T | undefined
  }

  run(sql: string, ...params: SqlValue[]): void {
    this.stmt(sql).run(...params)
  }

  /** 同步事务；异常回滚并重新抛出。 */
  tx<T>(fn: () => T): T {
    this.raw.exec('BEGIN')
    try {
      const out = fn()
      this.raw.exec('COMMIT')
      return out
    } catch (err) {
      try {
        this.raw.exec('ROLLBACK')
      } catch {
        /* 回滚失败也把原错抛出去 */
      }
      throw err
    }
  }

  close(): void {
    this.stmts.clear()
    this.raw.close()
  }
}

export function open(file: string): Db {
  const raw = new DatabaseSync(file)
  raw.exec('pragma journal_mode = wal')
  raw.exec('pragma synchronous = normal')
  raw.exec('pragma busy_timeout = 5000')
  raw.exec('pragma foreign_keys = on')
  return new Db(raw)
}
