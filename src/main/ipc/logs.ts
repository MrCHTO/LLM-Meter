import { app, shell } from 'electron'
import { copyFileSync } from 'node:fs'
import { join } from 'node:path'
import type { LogQuery } from '../../shared/types'
import * as cfg from '../store/config'
import * as live from '../store/live'
import * as db from '../store/db'
import * as repo from '../store/db/repo'
import { dataDir } from '../store/paths'
import { handle, logQuery, wrap } from './shared'

function pruneNow(): number {
  const s = cfg.get().settings
  return repo.prune(db.get(), Date.now(), s.retentionDays, s.rollupRetentionDays).requests
}

export function register(): void {
  handle(
    'history',
    wrap((days: number, modelId: string | null) => repo.daySeries(db.get(), Math.min(365, Math.max(1, days)), modelId))
  )

  handle(
    'info',
    wrap(() => ({ version: app.getVersion(), dataDir: dataDir(), platform: process.platform }))
  )

  handle(
    'openDataDir',
    wrap(async () => {
      await shell.openPath(dataDir())
      return true
    })
  )

  handle(
    'backup',
    wrap(() => {
      // 配置 JSON 原样拷走，数据库用 VACUUM INTO 取一致性快照
      const stamp = Date.now()
      const configTarget = join(dataDir(), `config.backup-${stamp}.json`)
      copyFileSync(join(dataDir(), 'config.json'), configTarget)
      const dbTarget = join(dataDir(), `data.backup-${stamp}.db`)
      repo.backupTo(db.get(), dbTarget)
      return `${configTarget}（数据库快照 ${dbTarget}）`
    })
  )

  handle(
    'recent',
    wrap((modelId: string, limit?: number) => live.recentFor(modelId, limit ?? 20))
  )

  handle(
    'logRequests',
    wrap((input: LogQuery) => repo.queryRequests(db.get(), logQuery(input)))
  )

  handle(
    'logApps',
    wrap((input: LogQuery) => repo.queryAppLogs(db.get(), logQuery(input)))
  )

  handle(
    'exportDaily',
    wrap(() => pruneNow())
  )

  handle(
    'cleanupEvents',
    wrap(() => {
      pruneNow()
      return true
    })
  )
}
