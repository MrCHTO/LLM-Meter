/**
 * 主进程与渲染进程共用的契约。改这里必须同时改 preload 与 ipc.ts。
 */

export type ApiFormat = 'openai' | 'anthropic'

export const FORMAT_LABEL: Record<ApiFormat, string> = {
  openai: 'OpenAI 兼容',
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
}

export interface Settings {
  port: number
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
}

export interface LiveSnapshot {
  ts: number
  proxyRunning: boolean
  proxyError: string | null
  baseUrl: string
  models: ModelLive[]
  totals: SnapshotTotals
}

export interface DayPoint {
  ts: number
  out: number
  req: number
  err: number
  cost: number
}

export interface ProbeRun {
  status: number
  ok: boolean
  ttftMs: number | null
  tps: number | null
  inputTokens: number
  cacheReadTokens: number
  outputTokens: number
  error?: string
}

export interface ProbeResult {
  modelId: string
  alias: string
  ok: boolean
  cold: ProbeRun
  warm: ProbeRun
  /** 第二次请求确实读到了缓存 */
  cacheEffective: boolean
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
  settings: Omit<Settings, 'localToken'> & { localTokenMasked: string; localToken: string }
  dataDir: string
  version: string
}

export interface ProviderTestResult {
  ok: boolean
  status: number
  message: string
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
  overlaySetHeight: 'overlay:setHeight',
  mainOpen: 'main:open'
} as const
