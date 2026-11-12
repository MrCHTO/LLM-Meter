import type { BrowserWindow } from 'electron'

let mainWindow: BrowserWindow | null = null
let overlayWindow: BrowserWindow | null = null

export function setMain(win: BrowserWindow | null): void {
  mainWindow = win
}

export function getMain(): BrowserWindow | null {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
}

export function setOverlay(win: BrowserWindow | null): void {
  overlayWindow = win
}

export function getOverlay(): BrowserWindow | null {
  return overlayWindow && !overlayWindow.isDestroyed() ? overlayWindow : null
}

export function send(channel: string, payload: unknown): void {
  for (const win of [getMain(), getOverlay()]) {
    if (!win) continue
    if (win.webContents.isLoading()) {
      win.webContents.once('did-finish-load', () => {
        if (!win.isDestroyed()) win.webContents.send(channel, payload)
      })
    } else {
      win.webContents.send(channel, payload)
    }
  }
}

export function showMain(): void {
  const win = getMain()
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}
