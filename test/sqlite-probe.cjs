// 探针：验证当前 Electron 是否内置 node:sqlite 且可读写
const { app } = require('electron')
const { join } = require('node:path')
const { tmpdir } = require('node:os')
const { rmSync } = require('node:fs')

app.disableHardwareAcceleration()

app.whenReady().then(() => {
  const file = join(tmpdir(), `llmmeter-sqlite-probe-${Date.now()}.db`)
  try {
    const { DatabaseSync } = require('node:sqlite')
    const db = new DatabaseSync(file)
    db.exec('create table t (a integer, b text)')
    db.prepare('insert into t values (?, ?)').run(7, 'ok')
    const row = db.prepare('select count(*) as c, sum(a) as s from t').get()
    db.exec('pragma journal_mode = wal')
    const mode = db.prepare('pragma journal_mode').get()
    db.close()
    console.log('NODE_SQLITE_OK', JSON.stringify(row), JSON.stringify(mode), 'node', process.versions.node)
    app.exit(0)
  } catch (err) {
    console.log('NODE_SQLITE_FAIL', err && err.message, 'node', process.versions.node)
    app.exit(2)
  } finally {
    try {
      rmSync(file, { force: true })
    } catch {
      /* 忽略 */
    }
  }
})
