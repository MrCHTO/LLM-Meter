import { Menu, Tray, app, nativeImage } from 'electron'
import * as cfg from '../store/config'
import * as overlay from './overlay'
import { markQuitting } from './main-window'
import { showMain } from './registry'

/** 16×16 计量柱图标，内联以便打包后不依赖资源路径 */
const ICON =
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAX0lEQVR4nGP4//8/AxIWyDvx/z8hjKyHAc0AA0oNCKDUgAJKDein1ID1lBpwnlID3qMpfA/DdDPgPJrC8zBMViCC+DBMdDTiwkQnJFyY6KRMJMadmYjEOA0QIBLD9QAAk+IuP7CKx/AAAAAASUVORK5CYII='

let tray: Tray | null = null

export function create(): void {
  tray = new Tray(nativeImage.createFromDataURL(`data:image/png;base64,${ICON}`))
  tray.setToolTip('LLM Meter')
  rebuild()

  tray.on('click', () => showMain())
}

export function rebuild(): void {
  if (!tray) return
  const visible = cfg.get().settings.overlay.visible
  const menu = Menu.buildFromTemplate([
    { label: '打开主窗口', click: () => showMain() },
    {
      label: visible ? '隐藏悬浮窗' : '显示悬浮窗',
      click: () => {
        cfg.mutate((c) => {
          c.settings.overlay.visible = !c.settings.overlay.visible
        })
        overlay.setVisible(!visible)
        rebuild()
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
