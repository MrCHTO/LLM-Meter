import { app, BrowserWindow } from 'electron'
import { CH } from '../shared/types'
import * as cfg from './store/config'
import * as events from './store/events'
import * as live from './store/live'
import * as rollup from './store/rollup'
import { ensureDirs } from './store/paths'
import * as proxy from './proxy/server'
import * as ipc from './ipc'
import * as mainWindow from './windows/main-window'
import * as overlay from './windows/overlay'
import * as tray from './windows/tray'
import { send, getMain, setMain } from './windows/registry'

let pushTimer: NodeJS.Timeout | null = null
let proxyError: string | null = null

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = getMain()
    if (win) {
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
    } else {
      mainWindow.create()
    }
  })

  app.whenReady().then(async () => {
    ensureDirs()
    const settings = cfg.get().settings

    rollup.init()
    live.init()
    live.replay(events.readRange(Date.now() - 15 * 60_000, Date.now()))
    events.cleanup(settings.retentionDays)
    rollup.cleanup(settings.rollupRetentionDays)

    proxy.bindDeps({ record: () => undefined })
    const state = await proxy.start(settings.port)
    proxyError = state.error

    ipc.register()

    tray.create()

    const win = mainWindow.create()
    setMain(win)
    if (settings.startMinimized) win.hide()

    if (settings.overlay.visible) overlay.create()

    cfg.onChange(() => {
      tray.rebuild()
      overlay.applySettings()
    })

    pushTimer = setInterval(() => {
      const snap = live.snapshot(proxy.getState().running, proxyError, proxy.baseUrl())
      send(CH.push, snap)
    }, 500)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWindow.create()
    })
  })

  app.on('window-all-closed', () => {
    // 托盘常驻，不退出
  })

  app.on('before-quit', () => {
    mainWindow.markQuitting()
    if (pushTimer) clearInterval(pushTimer)
    pushTimer = null
    tray.destroy()
    rollup.dispose()
    void proxy.stop()
  })
}

process.on('uncaughtException', (err) => {
  console.error('[main] uncaught', err)
})
process.on('unhandledRejection', (err) => {
  console.error('[main] unhandled', err)
})
