/**
 * IPC 契约的唯一事实源。
 *
 * 方法名 → 通道 + 入参 + 返回值只写在这里：preload 按 IpcApi 实现，
 * 主进程用 handle() 注册，渲染层从 window.api 拿到同一签名。
 * 加通道时三处不用再各抄一遍。
 */

import { CH } from '../types/channels'
import type { ConfigView, ProviderInput, Settings, ModelCfg, ApiFormat, OverlayEffect } from '../types/config'
import type { AppInfo, IpcResult } from '../types/misc'
import type { LiveSnapshot } from '../types/live'
import type { AppLog, LogPage, LogQuery } from '../types/log'
import type { ProbeResult, ProviderTestResult } from '../types/probe'
import type { RequestEvent, RequestLog, DayPoint } from '../types/request'
import type { StatsExportResult, StatsGroup, StatsQuery, StatsRow, StatsSeries, StatsSeriesQuery } from '../types/stats'

/** settingsUpdate 的入参：只允许改可调项 */
export type SettingsPatch = {
  port?: number
  usdCny?: number
  retentionDays?: number
  rollupRetentionDays?: number
  overlayOpacity?: number
  startMinimized?: boolean
  overlayWidth?: number
  overlayVisible?: boolean
  overlayModelId?: string | null
  overlayGlobal?: boolean
  overlayX?: number
  overlayY?: number
  allowLan?: boolean
  overlayTheme?: 'dark' | 'light'
  overlayEffect?: OverlayEffect
  overlaySpeed?: number
  overlayLocked?: boolean
  overlaySnapCenter?: boolean
  overlayShowProvider?: boolean
  overlayShowModel?: boolean
  overlayShowCost?: boolean
  startAtLogin?: boolean
  theme?: 'light' | 'dark' | 'system'
  autoCalibrate?: boolean
  autoProbeIntervalSec?: number
}

export type ProviderPatch = Partial<Omit<ProviderInput, 'apiKey'>> & { apiKey?: string }

export interface PriceLookupResult {
  found: boolean
  exact?: boolean
  matchedId?: string
  priceIn?: number
  priceOut?: number
  priceCacheRead?: number
  priceCacheInput?: number
  cacheWriteProbed?: boolean
  cacheWriteReported?: boolean
  note: string
}

export interface OverlayBoundsState {
  bounds: { x: number; y: number; width: number; height: number }
  area: { x: number; y: number; width: number; height: number }
  opacity: number
}

/** 方法名 → 入参元组与返回值 */
export interface IpcMethods {
  info: { args: []; result: AppInfo }
  config: { args: []; result: ConfigView }

  createProvider: { args: [input: ProviderInput]; result: string }
  updateProvider: { args: [id: string, patch: ProviderPatch]; result: boolean }
  deleteProvider: { args: [id: string]; result: boolean }
  testProvider: { args: [id: string]; result: ProviderTestResult }

  createModel: { args: [input: Omit<ModelCfg, 'id' | 'createdAt' | 'sort'>]; result: string }
  updateModel: { args: [id: string, patch: Partial<ModelCfg>]; result: boolean }
  deleteModel: { args: [id: string]; result: boolean }
  reorderModels: { args: [ids: string[]]; result: boolean }
  lookupPrice: { args: [modelId: string, providerId?: string]; result: PriceLookupResult }
  runProbe: { args: [id: string]; result: ProbeResult }
  stopProbe: { args: [id?: string]; result: void }

  updateSettings: { args: [patch: SettingsPatch]; result: boolean }
  rotateToken: { args: []; result: string }
  createToken: { args: [remark: string]; result: ConfigView['settings']['tokens'][number] }
  deleteToken: { args: [id: string]; result: boolean }
  updateToken: { args: [id: string, remark: string]; result: boolean }
  refreshRate: { args: []; result: { rate: number; date: string; fresh: boolean } }
  calibrate: { args: []; result: void }
  restartProxy: { args: []; result: unknown }

  history: { args: [days: number, modelId: string | null]; result: DayPoint[] }
  recent: { args: [modelId: string, limit?: number]; result: RequestEvent[] }
  statsSeries: { args: [q: StatsSeriesQuery]; result: StatsSeries }
  statsTotals: { args: [q: StatsQuery & { groupBy: StatsGroup }]; result: StatsRow[] }
  statsTop: { args: [q: StatsQuery & { by: 'cost' | 'requests' | 'output'; limit: number }]; result: StatsRow[] }
  statsExport: { args: [q: StatsQuery]; result: StatsExportResult }
  devSeed: { args: [count: number]; result: number }
  logRequests: { args: [query: LogQuery]; result: LogPage<RequestLog> }
  logApps: { args: [query: LogQuery]; result: LogPage<AppLog> }
  openDataDir: { args: []; result: boolean }
  backup: { args: []; result: string }
  exportDaily: { args: []; result: number }
  cleanupEvents: { args: []; result: boolean }

  overlayState: { args: []; result: OverlayBoundsState | null }
  overlayDragStart: { args: []; result: void }
  overlayDragEnd: { args: []; result: void }
  overlayHover: { args: [value: boolean]; result: void }
  overlayMenu: { args: []; result: void }
  overlayOpenMain: { args: []; result: void }
  overlaySetSize: { args: [width: number, height: number]; result: void }
  openMain: { args: []; result: void }
}

/** 主进程向渲染层推送的事件 */
export interface IpcEvents {
  push: LiveSnapshot
  calibrated: { rate: number; updated: number; missed: number }
}

/** 方法名 → 通道名。satisfies 保证不漏方法 */
export const CHANNEL_OF = {
  info: CH.info,
  config: CH.config,
  createProvider: CH.providerCreate,
  updateProvider: CH.providerUpdate,
  deleteProvider: CH.providerDelete,
  testProvider: CH.providerTest,
  createModel: CH.modelCreate,
  updateModel: CH.modelUpdate,
  deleteModel: CH.modelDelete,
  reorderModels: CH.modelReorder,
  lookupPrice: CH.priceLookup,
  runProbe: CH.probeRun,
  stopProbe: CH.probeStop,
  updateSettings: CH.settingsUpdate,
  rotateToken: CH.tokenRotate,
  createToken: CH.tokenCreate,
  deleteToken: CH.tokenDelete,
  updateToken: CH.tokenUpdate,
  refreshRate: CH.rateRefresh,
  calibrate: CH.calibrate,
  restartProxy: CH.proxyRestart,
  history: CH.history,
  recent: CH.recent,
  statsSeries: CH.statsSeries,
  statsTotals: CH.statsTotals,
  statsTop: CH.statsTop,
  statsExport: CH.statsExport,
  devSeed: CH.devSeed,
  logRequests: CH.logRequests,
  logApps: CH.logApps,
  openDataDir: CH.openDataDir,
  backup: CH.backup,
  exportDaily: CH.exportDaily,
  cleanupEvents: CH.eventsCleanup,
  overlayState: CH.overlayState,
  overlayDragStart: CH.overlayDragStart,
  overlayDragEnd: CH.overlayDragEnd,
  overlayHover: CH.overlayHover,
  overlayMenu: CH.overlayMenu,
  overlayOpenMain: CH.overlayOpenMain,
  overlaySetSize: CH.overlaySetSize,
  openMain: CH.mainOpen
} as const satisfies Record<keyof IpcMethods, string>

const EVENT_CHANNEL = { push: CH.push, calibrated: CH.calibrated } as const satisfies Record<keyof IpcEvents, string>

/** 渲染层拿到的 API：每个方法返回 IpcResult 包装 */
export type IpcApi = {
  [M in keyof IpcMethods]: (...args: IpcMethods[M]['args']) => Promise<IpcResult<IpcMethods[M]['result']>>
} & {
  onPush: (fn: (snapshot: IpcEvents['push']) => void) => () => void
  onCalibrated: (fn: (result: IpcEvents['calibrated']) => void) => () => void
}

export function channelOf<M extends keyof IpcMethods>(method: M): (typeof CHANNEL_OF)[M] {
  return CHANNEL_OF[method]
}

export function eventChannel<E extends keyof IpcEvents>(event: E): (typeof EVENT_CHANNEL)[E] {
  return EVENT_CHANNEL[event]
}

/** preload 的 invoke 包装：参数类型由契约约束 */
export function invoke<M extends keyof IpcMethods>(
  method: M,
  ...args: IpcMethods[M]['args']
): Promise<IpcResult<IpcMethods[M]['result']>> {
  return invokeRaw(channelOf(method), ...args)
}

/** ipcRenderer.invoke 的壳，单独抽出来便于 preload 与测试复用 */
let invokeRaw: (channel: string, ...args: unknown[]) => Promise<IpcResult<unknown>> = () => {
  throw new Error('invokeRaw 未绑定')
}

export function bindInvoke(fn: typeof invokeRaw): void {
  invokeRaw = fn
}

export type { ApiFormat, Settings }
