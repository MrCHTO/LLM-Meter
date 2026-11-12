/**
 * 主进程与渲染进程共用的契约。改这里必须同时改 preload 与 ipc.ts。
 */

export type ApiFormat = 'openai' | 'anthropic'

export const FORMAT_LABEL: Record<ApiFormat, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic Messages'
}

export const FORMAT_MOUNT: Record<ApiFormat, string> = {
  openai: '/openai',
  anthropic: '/anthropic'
}

export interface Provider {
  id: string
  name: string
  /** 上游根，不带结尾斜杠 */
  baseUrl: string
  format: ApiFormat
  /** DPAPI 密文 base64；safeStorage 不可用时为 raw: 前缀明文 */
  keyCipher: string
  enabled: boolean
  createdAt: number
}

export interface ModelCfg {
  id: string
  providerId: string
  /** 发给上游的真实模型名 */
  upstreamModel: string
  /** 客户端使用、悬浮窗显示的名字，全局唯一 */
  alias: string
  enabled: boolean
  /** 是否在悬浮窗列出 */
  watch: boolean
  /** 单价，单位：每百万 token */
  priceIn: number
  priceOut: number
  priceCacheRead: number
  priceCacheWrite: number
  currency: string
  /** 当日预算，null 表示不限 */
  dailyBudget: number | null
  sort: number
  createdAt: number
}

export interface OverlayState {
  x: number | null
  y: number | null
  width: number
  visible: boolean
  /** 胶囊盯住的模型，null 表示还没选 */
  modelId: string | null
  /** 锁定后拖不动，防误碰 */
  locked: boolean
  theme: 'dark' | 'light'
  /** 调节透明度模式：此时拖动改的是透明度而不是位置 */
  adjusting: boolean
}

export interface Settings {
  port: number
  /** 是否允许局域网访问（绑 0.0.0.0） */
  allowLan: boolean
  /** USD → CNY 汇率，价格与成本一律按人民币显示 */
  usdCny: number
  /** 汇率对应的日期，YYYY-MM-DD；取到当天值后不再重复请求 */
  usdCnyDate: string
  /** 本地入口 token，32 位 hex */
  localToken: string
  /** 明细保留天数 */
  retentionDays: number
  /** 分钟聚合保留天数 */
  rollupRetentionDays: number
  overlay: OverlayState
  /** 悬浮窗不透明度 30-100 */
  overlayOpacity: number
  /** 暂停探针（代理不受影响） */
  pauseProbe: boolean
  startMinimized: boolean
}

export interface ConfigFile {
  version: 1
  providers: Provider[]
  models: ModelCfg[]
  settings: Settings
}

export type RequestSource = 'proxy' | 'probe'

export type ErrorKind =
  | 'auth'
  | 'not_found'
  | 'model_disabled'
  | 'timeout'
  | 'aborted'
  | 'upstream_4xx'
  | 'upstream_5xx'
  | 'network'
  | 'parse'
  | 'unsupported'

/** 一次请求的落盘形态，一行 JSONL */
export interface RequestEvent {
  id: string
  ts: number
  source: RequestSource
  modelId: string
  alias: string
  providerId: string
  status: number
  ok: boolean
  errorKind: ErrorKind | null
  stream: boolean
  /** 首个有效内容帧耗时；非流式为 null */
  ttftMs: number | null
  durationMs: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  cost: number
  currency: string
  /** 仅内存，给明细列表用；不落盘 */
  note?: string
}

export interface TodayTotals {
  requests: number
  errors: number
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  cost: number
}

export interface ModelLive {
  modelId: string
  alias: string
  providerName: string
  /** 上游根地址，界面直接展示 */
  baseUrl: string
  /** 真正发给上游的模型名 */
  upstreamModel: string
  format: ApiFormat
  currency: string
  dailyBudget: number | null
  watch: boolean
  buckets: number[]
  tps: number
  /** 今日缓存命中率，无输入 token 时为 null */
  hitRate: number | null
  today: TodayTotals
  /** 今日成本 / 预算；无预算为 null */
  budgetRatio: number | null
  lastError: string | null
  lastErrorAt: number | null
  lastTtftMs: number | null
  /** 正在进行的请求数 */
  inflight: number
  /** 是否该显示流光：进行中，或刚结束 3 秒内 */
  active: boolean
  probing: boolean
  paused: boolean
}

export interface SnapshotTotals {
  tps: number
  hitRate: number | null
  todayCost: number
  requests: number
  errors: number
  budgetRatio: number | null
  budgetSum: number
  currency: string
  /** 各模型桶按秒相加，给汇总曲线用 */
  buckets: number[]
  /** 每秒请求数 */
  reqBuckets: number[]
}

export interface LiveSnapshot {
  ts: number
  proxyRunning: boolean
  proxyError: string | null
  baseUrl: string
  models: ModelLive[]
  totals: SnapshotTotals
  /** 胶囊盯住的模型，随每次推送带下去 */
  overlayModelId: string | null
  /** 悬浮窗外观与交互状态 */
  overlay: OverlayState
}

export interface DayPoint {
  ts: number
  out: number
  req: number
  err: number
  cost: number
}

export interface ProbeResult {
  modelId: string
  alias: string
  ok: boolean
  status: number
  ttftMs: number | null
  tps: number | null
  inputTokens: number
  outputTokens: number
  error?: string
  message: string
}

export interface ProviderInput {
  name: string
  baseUrl: string
  format: ApiFormat
  apiKey: string
  enabled: boolean
}

export interface ModelInput {
  providerId: string
  upstreamModel: string
  alias: string
  enabled: boolean
  watch: boolean
  priceIn: number
  priceOut: number
  priceCacheRead: number
  priceCacheWrite: number
  currency: string
  dailyBudget: number | null
}

export interface AppInfo {
  version: string
  dataDir: string
  platform: string
}

/** 渲染层看到的供应商：不含密文，只告诉有没有 key、以及掩码回显 */
export interface ProviderView extends Omit<Provider, 'keyCipher'> {
  hasKey: boolean
  keyMasked: string
}

export interface ConfigView {
  providers: ProviderView[]
  models: ModelCfg[]
  settings: Omit<Settings, 'localToken'> & { localTokenMasked: string; localToken: string; lanIp: string }
  dataDir: string
  version: string
}

export interface ProviderTestResult {
  ok: boolean
  status: number
  message: string
}

/* ------------------------------- 分析接口 ------------------------------- */

export type StatsMetric = 'requests' | 'errors' | 'input' | 'output' | 'cache_read' | 'cost' | 'tps'
export type StatsGranularity = 'minute' | 'hour' | 'day'
export type StatsGroup = 'model' | 'provider'
export type StatsSource = 'all' | 'proxy' | 'probe'

export interface StatsQuery {
  from: number
  to: number
  source: StatsSource
}

export interface StatsSeriesQuery extends StatsQuery {
  granularity: StatsGranularity
  metric: StatsMetric
  groupBy: StatsGroup
}

export interface StatsSeries {
  buckets: number[]
  series: { key: string; label: string; points: number[] }[]
}

export interface StatsRow {
  key: string
  label: string
  requests: number
  errors: number
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  cost: number
  avgTtft: number | null
  tps: number | null
}

export interface StatsExportResult {
  path: string
  rows: number
}

export interface IpcResult<T> {
  ok: boolean
  data?: T
  error?: string
}

export const CH = {
  snapshot: 'app:snapshot',
  push: 'app:push',
  info: 'app:info',
  config: 'config:read',
  providerCreate: 'provider:create',
  providerUpdate: 'provider:update',
  providerDelete: 'provider:delete',
  providerTest: 'provider:test',
  modelCreate: 'model:create',
  modelUpdate: 'model:update',
  modelDelete: 'model:delete',
  priceLookup: 'model:price',
  rateRefresh: 'rate:refresh',
  probeRun: 'probe:run',
  probeStop: 'probe:stop',
  settingsUpdate: 'settings:update',
  tokenRotate: 'settings:rotateToken',
  proxyRestart: 'proxy:restart',
  history: 'history:read',
  recent: 'history:recent',
  openDataDir: 'app:openDataDir',
  backup: 'app:backup',
  probePause: 'probe:pause',
  exportDaily: 'app:exportDaily',
  eventsCleanup: 'app:eventsCleanup',
  overlayState: 'overlay:state',
  overlayDragStart: 'overlay:dragStart',
  overlayDragEnd: 'overlay:dragEnd',
  overlayMenu: 'overlay:menu',
  overlayHover: 'overlay:hover',
  overlayOpenMain: 'overlay:openMain',
  overlaySetSize: 'overlay:setSize',
  mainOpen: 'main:open',
  statsSeries: 'stats:series',
  statsTotals: 'stats:totals',
  statsTop: 'stats:top',
  statsExport: 'stats:export',
  devSeed: 'dev:seed'
} as const
