import { contextBridge, ipcRenderer } from 'electron'
import { bindInvoke, eventChannel, invoke, type IpcApi, type IpcEvents } from '../shared/ipc/contract'

bindInvoke((channel, ...args) => ipcRenderer.invoke(channel, ...args))

function on<E extends keyof IpcEvents>(event: E, fn: (payload: IpcEvents[E]) => void): () => void {
  const channel = eventChannel(event)
  const handler = (_e: Electron.IpcRendererEvent, payload: IpcEvents[E]): void => fn(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const api: IpcApi = {
  info: () => invoke('info'),
  config: () => invoke('config'),

  createProvider: (input) => invoke('createProvider', input),
  updateProvider: (id, patch) => invoke('updateProvider', id, patch),
  deleteProvider: (id) => invoke('deleteProvider', id),
  testProvider: (id) => invoke('testProvider', id),

  createModel: (input) => invoke('createModel', input),
  updateModel: (id, patch) => invoke('updateModel', id, patch),
  deleteModel: (id) => invoke('deleteModel', id),
  reorderModels: (ids) => invoke('reorderModels', ids),
  lookupPrice: (modelId, providerId) => invoke('lookupPrice', modelId, providerId),
  runProbe: (id) => invoke('runProbe', id),
  stopProbe: (id) => invoke('stopProbe', id),

  updateSettings: (patch) => invoke('updateSettings', patch),
  rotateToken: () => invoke('rotateToken'),
  createToken: (remark) => invoke('createToken', remark),
  deleteToken: (id) => invoke('deleteToken', id),
  updateToken: (id, remark) => invoke('updateToken', id, remark),
  refreshRate: () => invoke('refreshRate'),
  calibrate: () => invoke('calibrate'),
  restartProxy: () => invoke('restartProxy'),

  history: (days, modelId) => invoke('history', days, modelId),
  recent: (modelId, limit) => invoke('recent', modelId, limit),
  statsSeries: (q) => invoke('statsSeries', q),
  statsTotals: (q) => invoke('statsTotals', q),
  statsTop: (q) => invoke('statsTop', q),
  statsExport: (q) => invoke('statsExport', q),
  devSeed: (count) => invoke('devSeed', count),
  logRequests: (query) => invoke('logRequests', query),
  logApps: (query) => invoke('logApps', query),
  openDataDir: () => invoke('openDataDir'),
  backup: () => invoke('backup'),
  exportDaily: () => invoke('exportDaily'),
  cleanupEvents: () => invoke('cleanupEvents'),

  overlayState: () => invoke('overlayState'),
  overlayDragStart: () => invoke('overlayDragStart'),
  overlayDragEnd: () => invoke('overlayDragEnd'),
  overlayHover: (value) => invoke('overlayHover', value),
  overlayMenu: () => invoke('overlayMenu'),
  overlayOpenMain: () => invoke('overlayOpenMain'),
  overlaySetSize: (width, height) => invoke('overlaySetSize', width, height),
  openMain: () => invoke('openMain'),

  onPush: (fn) => on('push', fn),
  onCalibrated: (fn) => on('calibrated', fn)
}

contextBridge.exposeInMainWorld('api', api)
