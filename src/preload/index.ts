import { contextBridge, ipcRenderer } from 'electron'
import { CH } from '../shared/types'

const api = {
  config: () => ipcRenderer.invoke(CH.config),
  info: () => ipcRenderer.invoke(CH.info),

  createProvider: (input: unknown) => ipcRenderer.invoke(CH.providerCreate, input),
  updateProvider: (id: string, patch: unknown) => ipcRenderer.invoke(CH.providerUpdate, id, patch),
  deleteProvider: (id: string) => ipcRenderer.invoke(CH.providerDelete, id),
  testProvider: (id: string) => ipcRenderer.invoke(CH.providerTest, id),

  createModel: (input: unknown) => ipcRenderer.invoke(CH.modelCreate, input),
  updateModel: (id: string, patch: unknown) => ipcRenderer.invoke(CH.modelUpdate, id, patch),
  deleteModel: (id: string) => ipcRenderer.invoke(CH.modelDelete, id),
  lookupPrice: (modelId: string) => ipcRenderer.invoke(CH.priceLookup, modelId),
  runProbe: (id: string) => ipcRenderer.invoke(CH.probeRun, id),
  stopProbe: (id?: string) => ipcRenderer.invoke(CH.probeStop, id),
  pauseProbe: (value: boolean) => ipcRenderer.invoke(CH.probePause, value),

  updateSettings: (patch: unknown) => ipcRenderer.invoke(CH.settingsUpdate, patch),
  rotateToken: () => ipcRenderer.invoke(CH.tokenRotate),
  restartProxy: () => ipcRenderer.invoke(CH.proxyRestart),

  history: (days: number, modelId: string | null) => ipcRenderer.invoke(CH.history, days, modelId),
  recent: (modelId: string, limit?: number) => ipcRenderer.invoke(CH.recent, modelId, limit),
  openDataDir: () => ipcRenderer.invoke(CH.openDataDir),
  backup: () => ipcRenderer.invoke(CH.backup),
  exportDaily: () => ipcRenderer.invoke(CH.exportDaily),
  cleanupEvents: () => ipcRenderer.invoke(CH.eventsCleanup),

  overlayState: () => ipcRenderer.invoke(CH.overlayState),
  overlayDragStart: () => ipcRenderer.invoke(CH.overlayDragStart),
  overlayDragEnd: () => ipcRenderer.invoke(CH.overlayDragEnd),
  overlayHover: (value: boolean) => ipcRenderer.invoke(CH.overlayHover, value),
  overlayMenu: () => ipcRenderer.invoke(CH.overlayMenu),
  overlayOpenMain: () => ipcRenderer.invoke(CH.overlayOpenMain),
  overlaySetHeight: (height: number) => ipcRenderer.invoke(CH.overlaySetHeight, height),
  openMain: () => ipcRenderer.invoke(CH.mainOpen),

  onPush: (fn: (snapshot: unknown) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, payload: unknown): void => fn(payload)
    ipcRenderer.on(CH.push, handler)
    return () => ipcRenderer.removeListener(CH.push, handler)
  }
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
