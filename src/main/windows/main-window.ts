import { BrowserWindow, app, nativeTheme, shell } from 'electron'
import { join } from 'node:path'
import { setMain } from './registry'
import * as cfg from '../store/config'

export function isQuitting(): boolean {
  return quitting
}

let quitting = false
export function markQuitting(): void {
  quitting = true
}

/** 主题解析成深色与否：system 走系统偏好 */
export function resolveDark(): boolean {
  const theme = cfg.get().settings.theme
  return theme === 'dark' || (theme === 'system' && nativeTheme.shouldUseDarkColors)
}

/** 窗口底色（与渲染层 --bg 一致，避免启动/切换白闪） */
export function backgroundColor(): string {
  return resolveDark() ? '#14171c' : '#f5f6f8'
}

/** 设置变更或系统主题变化后刷新窗口底色 */
export function applyTheme(): void {
  const win = getWin()
  if (win && !win.isDestroyed()) win.setBackgroundColor(backgroundColor())
}

let win: BrowserWindow | null = null
function getWin(): BrowserWindow | null {
  return win
}

export function create(): BrowserWindow {
  const created = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 940,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: backgroundColor(),
    title: `LLM Meter ${app.getVersion()}`,
    icon: join(__dirname, '../../resources/icon.ico'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true
    }
  })

  created.on('ready-to-show', () => {
    created.show()
  })

  created.on('close', (event) => {
    if (quitting) return
    event.preventDefault()
    created.hide()
  })

  created.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void created.loadURL(`${process.env.ELECTRON_RENDERER_URL}/index.html`)
  } else {
    void created.loadFile(join(__dirname, '../renderer/index.html'))
  }

  win = created
  setMain(created)
  return created
}
