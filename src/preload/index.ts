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
  reorderModels: (ids: string[]) => ipcRenderer.invoke(CH.modelReorder, ids),
  lookupPrice: (modelId: string) => ipcRenderer.invoke(CH.priceLookup, modelId),
  runProbe: (id: string) => ipcRenderer.invoke(CH.probeRun, id),
  stopProbe: (id?: string) => ipcRenderer.invoke(CH.probeStop, id),

  updateSettings: (patch: unknown) => ipcRenderer.invoke(CH.settingsUpdate, patch),
  rotateToken: () => ipcRenderer.invoke(CH.tokenRotate),
  createToken: (remark: string) => ipcRenderer.invoke(CH.tokenCreate, remark),
  deleteToken: (id: string) => ipcRenderer.invoke(CH.tokenDelete, id),
  refreshRate: () => ipcRenderer.invoke(CH.rateRefresh),
  calibrate: () => ipcRenderer.invoke(CH.calibrate),
  restartProxy: () => ipcRenderer.invoke(CH.proxyRestart),

  history: (days: number, modelId: string | null) => ipcRenderer.invoke(CH.history, days, modelId),
  statsSeries: (q: unknown) => ipcRenderer.invoke(CH.statsSeries, q),
  statsTotals: (q: unknown) => ipcRenderer.invoke(CH.statsTotals, q),
  statsTop: (q: unknown) => ipcRenderer.invoke(CH.statsTop, q),
  statsExport: (q: unknown) => ipcRenderer.invoke(CH.statsExport, q),
  devSeed: (count: number) => ipcRenderer.invoke(CH.devSeed, count),
  recent: (modelId: string, limit?: number) => ipcRenderer.invoke(CH.recent, modelId, limit),
  logRequests: (query: unknown) => ipcRenderer.invoke(CH.logRequests, query),
  logApps: (query: unknown) => ipcRenderer.invoke(CH.logApps, query),
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
  overlaySetSize: (width: number, height: number) => ipcRenderer.invoke(CH.overlaySetSize, width, height),
  openMain: () => ipcRenderer.invoke(CH.mainOpen),

  onPush: (fn: (snapshot: unknown) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, payload: unknown): void => fn(payload)
    ipcRenderer.on(CH.push, handler)
    return () => ipcRenderer.removeListener(CH.push, handler)
  },
  onCalibrated: (fn: (result: unknown) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, payload: unknown): void => fn(payload)
    ipcRenderer.on(CH.calibrated, handler)
    return () => ipcRenderer.removeListener(CH.calibrated, handler)
  }
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
