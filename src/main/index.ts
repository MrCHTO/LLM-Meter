import { app, BrowserWindow } from 'electron'
import { CH } from '../shared/types'
import * as cfg from './store/config'
import * as live from './store/live'
import * as db from './store/db'
import * as repo from './store/db/repo'
import { ensureDirs } from './store/paths'
import * as proxy from './proxy/server'
import * as calibrate from './calibrate'
import * as autoProbe from './probe/auto'
import * as ipc from './ipc'
import * as mainWindow from './windows/main-window'
import * as overlay from './windows/overlay'
import * as tray from './windows/tray'
import { send, getMain, setMain } from './windows/registry'

let pushTimer: NodeJS.Timeout | null = null
let calTimer: NodeJS.Timeout | null = null
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

    db.init()
    live.init()
    // 曲线只画最近 60 秒，回放范围跟着收窄
    live.replay(repo.replaySince(db.get(), Date.now() - 65_000))

    proxy.bindDeps({ record: () => undefined })
    const state = await proxy.start(settings.port)
    proxyError = state.error

    ipc.register()

    tray.create()

    const win = mainWindow.create()
    setMain(win)
    if (settings.startMinimized) win.hide()

    if (settings.overlay.visible) overlay.create()

    // 端口或局域网开关变了会自动重启代理，登录项变了同步注册表（托盘、设置页共用这一条出口）
    let lastNet = { port: settings.port, allowLan: settings.allowLan }
    let lastLogin = settings.startAtLogin
    const applyLogin = (on: boolean): void => {
      try {
        app.setLoginItemSettings({ openAtLogin: on, path: process.execPath, args: [] })
      } catch {
        /* 注册表写不进去就下次再说 */
      }
    }
    applyLogin(lastLogin)
    cfg.onChange(() => {
      const s = cfg.get().settings
      tray.rebuild()
      overlay.applySettings()
      // 配置一变就推一帧，胶囊不用等 500ms 轮询，选中状态与列表始终一致
      send(CH.push, live.snapshot(proxy.getState().running, proxyError, proxy.baseUrl()))
      if (s.port !== lastNet.port || s.allowLan !== lastNet.allowLan) {
        lastNet = { port: s.port, allowLan: s.allowLan }
        void proxy.start(s.port).then((st) => {
          proxyError = st.error
        })
      }
      if (s.startAtLogin !== lastLogin) {
        lastLogin = s.startAtLogin
        applyLogin(lastLogin)
      }
    })

    pushTimer = setInterval(() => {
      const snap = live.snapshot(proxy.getState().running, proxyError, proxy.baseUrl())
      send(CH.push, snap)
    }, 500)

    // 启动 3 秒后跑一次自动校准，之后每天 00:00 一次
    setTimeout(() => void calibrate.run(), 3000)
    const scheduleMidnight = (): void => {
      const now = new Date()
      const next = new Date(now)
      next.setHours(24, 0, 0, 0)
      calTimer = setTimeout(() => {
        void calibrate.run().finally(scheduleMidnight)
      }, next.getTime() - now.getTime())
    }
    scheduleMidnight()
    autoProbe.start()

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
    if (calTimer) clearTimeout(calTimer)
    calTimer = null
    autoProbe.stop()
    tray.destroy()
    db.close()
    void proxy.stop()
  })
}

process.on('uncaughtException', (err) => {
  console.error('[main] uncaught', err)
})
process.on('unhandledRejection', (err) => {
  console.error('[main] unhandled', err)
})
