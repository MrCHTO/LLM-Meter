import { app, dialog, nativeTheme, BrowserWindow } from 'electron'
import { CH } from '../shared/types'
import * as cfg from './store/config'
import * as live from './store/live'
import * as db from './store/db'
import * as repo from './store/db/repo'
import { ensureDirs } from './store/paths'
import * as proxy from './proxy/server'
import * as calibrate from './calibrate'
import * as settingsService from './settings/service'
import * as autoProbe from './probe/auto'
import * as ipc from './ipc'
import * as applog from './applog'
import * as mainWindow from './windows/main-window'
import * as overlay from './windows/overlay'
import * as tray from './windows/tray'
import { anyVisible, send, getMain, setMain } from './windows/registry'

let pushTimer: NodeJS.Timeout | null = null
let calTimer: NodeJS.Timeout | null = null
let setSettingsOff: (() => void) | null = null
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
    // 曲线只画最近窗口（BUCKETS 秒），回放范围跟着走，多留 5 秒余量
    live.replay(repo.replaySince(db.get(), Date.now() - (live.BUCKETS * 1000 + 5000)))


    const state = await proxy.start(settings.port)
    proxyError = state.error
    if (state.running) applog.info('proxy', `代理已启动，端口 ${settings.port}`)
    else applog.error('proxy', `代理启动失败：${state.error ?? '未知原因'}`)
    applog.info('startup', `LLM Meter 启动，版本 ${app.getVersion()}`)

    ipc.register()

    tray.create()

    const win = mainWindow.create()
    setMain(win)
    if (settings.startMinimized) win.hide()

    if (settings.overlay.visible) overlay.create()

    // 跟随系统时，系统深浅色一变就刷新窗口底色与页面
    nativeTheme.on('updated', () => {
      if (cfg.get().settings.theme !== 'system') return
      mainWindow.applyTheme()
      send(CH.push, live.snapshot(proxy.getState().running, proxyError, proxy.baseUrl()))
    })
    const applyLogin = (on: boolean): void => {
      try {
        app.setLoginItemSettings({ openAtLogin: on, path: process.execPath, args: [] })
      } catch {
        /* 注册表写不进去就下次再说 */
      }
    }
    applyLogin(settings.startAtLogin)

    // 设置项副作用集中在这里：设置页、托盘、悬浮窗菜单只负责写
    setSettingsOff = settingsService.onChange(({ before, after, keys }) => {
      tray.rebuild()
      overlay.applySettings()
      if ((keys.includes('overlayX') || keys.includes('overlayY')) && after.overlay.x !== null && after.overlay.y !== null) {
        overlay.moveTo(after.overlay.x, after.overlay.y)
      }
      if (keys.includes('overlayVisible')) overlay.setVisible(after.overlay.visible)
      if (keys.includes('theme') && after.theme !== before.theme) mainWindow.applyTheme()
      if (after.port !== before.port || after.allowLan !== before.allowLan) {
        applog.info('settings', `接入设置变更：端口 ${after.port}，局域网${after.allowLan ? '开' : '关'}`)
        void proxy.start(after.port).then((st) => {
          proxyError = st.error
          if (!st.running) applog.error('proxy', `重启失败：${st.error ?? '未知原因'}`)
        })
      }
      if (after.startAtLogin !== before.startAtLogin) {
        applog.info('settings', `开机自启${after.startAtLogin ? '开' : '关'}`)
        applyLogin(after.startAtLogin)
      }
    })

    cfg.onChange(() => {
      // 配置一变就推一帧，胶囊不用等 500ms 轮询，选中状态与列表始终一致
      send(CH.push, live.snapshot(proxy.getState().running, proxyError, proxy.baseUrl()))
    })

    // 主窗与胶囊都收起来时不再算快照，省掉每 500ms 的桶复制
    const tickPush = (): void => {
      if (anyVisible()) {
        send(CH.push, live.snapshot(proxy.getState().running, proxyError, proxy.baseUrl()))
      }
      pushTimer = setTimeout(tickPush, 500)
    }
    tickPush()

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
    .catch((err: unknown) => {
      // 启动链整段失败时，用户至少要知道，而不是只剩一个没有窗口的进程
      applog.error('startup', `启动失败：${err instanceof Error ? err.message : String(err)}`)
      dialog.showErrorBox('LLM Meter 启动失败', err instanceof Error ? err.message : String(err))
    })

  app.on('window-all-closed', () => {
    // 托盘常驻，不退出
  })

  app.on('before-quit', () => {
    mainWindow.markQuitting()
    if (pushTimer) clearTimeout(pushTimer)
    pushTimer = null
    if (calTimer) clearTimeout(calTimer)
    calTimer = null
    setSettingsOff?.()
    setSettingsOff = null
    autoProbe.stop()
    tray.destroy()
    db.close()
    void proxy.stop()
  })
}

process.on('uncaughtException', (err) => {
  console.error('[main] uncaught', err)
  applog.error('startup', `未捕获异常：${err.message}`)
})
process.on('unhandledRejection', (err) => {
  console.error('[main] unhandled', err)
  applog.error('startup', `未处理拒绝：${err instanceof Error ? err.message : String(err)}`)
})
