import { Menu, Tray, app } from 'electron'
import { join } from 'node:path'
import * as cfg from '../store/config'
import * as proxy from '../proxy/server'
import * as overlay from './overlay'
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
      click: () => {
        cfg.mutate((c) => {
          c.settings.overlay.visible = !c.settings.overlay.visible
        })
        overlay.setVisible(!s.overlay.visible)
        rebuild()
      }
    },
    {
      label: s.allowLan ? '关闭局域网' : '开启局域网',
      // 开关后由 index.ts 的 cfg.onChange 统一重启代理
      click: () => {
        cfg.mutate((c) => {
          c.settings.allowLan = !c.settings.allowLan
        })
      }
    },
    {
      label: '重启代理',
      click: () => {
        void proxy.start(cfg.get().settings.port)
      }
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
