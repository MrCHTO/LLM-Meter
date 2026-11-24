import { Menu, Tray, app } from 'electron'
import { join } from 'node:path'
import * as cfg from '../store/config'
import * as settings from '../settings/service'
import * as proxy from '../proxy/server'
import { markQuitting } from './main-window'
import { showMain } from './registry'

/** 多尺寸 ico（16/24/32，scripts/make-icons.mjs 生成），Windows 托盘自动挑合适帧 */
const TRAY_ICON = join(__dirname, '../../resources/tray.ico')

let tray: Tray | null = null

export function create(): void {
  tray = new Tray(TRAY_ICON)
  tray.setToolTip(`LLM Meter ${app.getVersion()}`)
  rebuild()

  tray.on('click', () => showMain())
}

export function rebuild(): void {
  if (!tray) return
  const s = cfg.get().settings
  const menu = Menu.buildFromTemplate([
    { label: '打开主窗口', click: () => showMain() },
    {
      label: s.overlay.visible ? '隐藏悬浮窗' : '显示悬浮窗',
      click: () => settings.update({ overlayVisible: !s.overlay.visible })
    },
    {
      label: s.allowLan ? '关闭局域网' : '开启局域网',
      // 开关后由 settings 的服务端订阅统一重启代理
      click: () => settings.update({ allowLan: !s.allowLan })
    },
    {
      label: '重启代理',
      click: () => {
        void proxy.start(cfg.get().settings.port)
      }
    },
    {
      label: s.overlay.locked ? '解锁位置' : '锁定位置',
      click: () => settings.update({ overlayLocked: !s.overlay.locked })
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        markQuitting()
        app.quit()
      }
    }
  ])
  tray.setContextMenu(menu)
}

export function destroy(): void {
  tray?.destroy()
  tray = null
}
