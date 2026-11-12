import { BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { setMain } from './registry'

export function isQuitting(): boolean {
  return quitting
}

let quitting = false
export function markQuitting(): void {
  quitting = true
}

export function create(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 940,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#f5f6f8',
    title: 'LLM Meter',
    icon: join(__dirname, '../../resources/icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true
    }
  })

  win.on('ready-to-show', () => {
    win.show()
  })

  win.on('close', (event) => {
    if (quitting) return
    event.preventDefault()
    win.hide()
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/index.html`)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  setMain(win)
  return win
}
