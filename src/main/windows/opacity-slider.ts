import { BrowserWindow, screen } from 'electron'
import { join } from 'node:path'

/**
 * 透明度滑条弹层：从胶囊菜单「调节透明度」打开，像子菜单一样贴着光标。
 * 失焦即关。
 */
const W = 240
const H = 78

let win: BrowserWindow | null = null

export function open(): void {
  if (win) {
    win.focus()
    return
  }
  const cursor = screen.getCursorScreenPoint()
  const area = screen.getDisplayNearestPoint(cursor).workArea
  const x = Math.min(Math.max(area.x + 8, cursor.x + 8), area.x + area.width - W - 8)
  const y = Math.min(Math.max(area.y + 8, cursor.y + 8), area.y + area.height - H - 8)

  win = new BrowserWindow({
    width: W,
    height: H,
    x,
    y,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true
    }
  })
  win.setAlwaysOnTop(true, 'floating')
  win.setMenuBarVisibility(false)
  win.on('blur', () => win?.close())
  win.on('closed', () => {
    win = null
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/slider.html`)
  } else {
    void win.loadFile(join(__dirname, '../renderer/slider.html'))
  }
  win.on('ready-to-show', () => win?.show())
}

export function close(): void {
  win?.close()
}
