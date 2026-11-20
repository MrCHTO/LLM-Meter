import type {
  AccessToken,
  ApiFormat,
  AppLog,
  ConfigView,
  DayPoint,
  IpcResult,
  LiveSnapshot,
  LogPage,
  LogQuery,
  ModelCfg,
  ProbeResult,
  ProviderTestResult,
  RequestEvent,
  RequestLog,
  StatsExportResult,
  StatsGroup,
  StatsQuery,
  StatsRow,
  StatsSeries,
  StatsSeriesQuery
} from '../shared/types'

declare global {
  interface Window {
    api: {
      config: () => Promise<IpcResult<ConfigView>>
      info: () => Promise<IpcResult<{ version: string; dataDir: string; platform: string }>>

      createProvider: (input: {
        name: string
        baseUrl: string
        format: ApiFormat
        apiKey: string
        enabled: boolean
      }) => Promise<IpcResult<string>>
      updateProvider: (
        id: string,
        patch: { name?: string; baseUrl?: string; format?: ApiFormat; apiKey?: string; enabled?: boolean }
      ) => Promise<IpcResult<boolean>>
      deleteProvider: (id: string) => Promise<IpcResult<boolean>>
      testProvider: (id: string) => Promise<IpcResult<ProviderTestResult>>

      createModel: (input: Omit<ModelCfg, 'id' | 'createdAt' | 'sort'>) => Promise<IpcResult<string>>
      updateModel: (id: string, patch: Partial<ModelCfg>) => Promise<IpcResult<boolean>>
      deleteModel: (id: string) => Promise<IpcResult<boolean>>
      reorderModels: (ids: string[]) => Promise<IpcResult<boolean>>
      lookupPrice: (modelId: string, providerId?: string) => Promise<
        IpcResult<{
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
        }>
      >
      runProbe: (id: string) => Promise<IpcResult<ProbeResult>>
      stopProbe: (id?: string) => Promise<IpcResult<boolean>>

      updateSettings: (patch: {
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
        overlaySnapEdges?: boolean
        overlayX?: number
        overlayY?: number
        allowLan?: boolean
        overlayTheme?: 'dark' | 'light'
        overlayLocked?: boolean
        overlayShowProvider?: boolean
        overlayShowModel?: boolean
        overlayShowCost?: boolean
        startAtLogin?: boolean
        theme?: 'light' | 'dark' | 'system'
        autoCalibrate?: boolean
        autoProbeIntervalSec?: number
      }) => Promise<IpcResult<boolean>>
      rotateToken: () => Promise<IpcResult<string>>
      createToken: (remark: string) => Promise<IpcResult<AccessToken>>
      deleteToken: (id: string) => Promise<IpcResult<boolean>>
      updateToken: (id: string, remark: string) => Promise<IpcResult<boolean>>
      refreshRate: () => Promise<IpcResult<{ rate: number; date: string; fresh: boolean }>>
      calibrate: () => Promise<IpcResult<void>>
      restartProxy: () => Promise<IpcResult<unknown>>

      history: (days: number, modelId: string | null) => Promise<IpcResult<DayPoint[]>>
      statsSeries: (q: StatsSeriesQuery) => Promise<IpcResult<StatsSeries>>
      statsTotals: (q: StatsQuery & { groupBy: StatsGroup }) => Promise<IpcResult<StatsRow[]>>
      statsTop: (
        q: StatsQuery & { by: 'cost' | 'requests' | 'output'; limit: number }
      ) => Promise<IpcResult<StatsRow[]>>
      statsExport: (q: StatsQuery) => Promise<IpcResult<StatsExportResult>>
      devSeed: (count: number) => Promise<IpcResult<number>>
      recent: (modelId: string, limit?: number) => Promise<IpcResult<RequestEvent[]>>
      logRequests: (query: LogQuery) => Promise<IpcResult<LogPage<RequestLog>>>
      logApps: (query: LogQuery) => Promise<IpcResult<LogPage<AppLog>>>
      openDataDir: () => Promise<IpcResult<boolean>>
      backup: () => Promise<IpcResult<string>>
      exportDaily: () => Promise<IpcResult<number>>
      cleanupEvents: () => Promise<IpcResult<boolean>>

      overlayDragStart: () => Promise<IpcResult<void>>
      overlayDragEnd: () => Promise<IpcResult<void>>
      overlayHover: (value: boolean) => Promise<IpcResult<void>>
      overlayMenu: () => Promise<IpcResult<void>>
      overlayOpenMain: () => Promise<IpcResult<void>>
      overlaySetSize: (width: number, height: number) => Promise<IpcResult<void>>
      overlayState: () => Promise<
        IpcResult<{ bounds: { x: number; y: number; width: number; height: number }; area: { x: number; y: number; width: number; height: number } } | null>
      >
      openMain: () => Promise<IpcResult<void>>

      onPush: (fn: (snapshot: LiveSnapshot) => void) => () => void
      onCalibrated: (fn: (result: { rate: number; updated: number; missed: number }) => void) => () => void
    }
  }
}

export {}
