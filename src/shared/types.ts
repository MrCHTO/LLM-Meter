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
  /** 是否在仪表盘增量曲线显示 */
  showRate: boolean
  /** 单价，单位：每百万 token */
  priceIn: number
  priceOut: number
  priceCacheRead: number
  priceCacheInput: number
  currency: string
  /** 价格来源：自动校准的会被每天刷新，手动改过的不动 */
  priceSource: 'auto' | 'manual'
  /** 自动探活：开启后按设置的间隔向该模型发极轻请求 */
  autoProbe: boolean
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
}

export interface AccessToken {
  id: string
  /** 用途备注，必填，也是分析里的分组名 */
  remark: string
  /** 完整 token，界面点一下即可复制 */
  token: string
  createdAt: number
}

export interface Settings {
  port: number
  /** 是否允许局域网访问（绑 0.0.0.0） */
  allowLan: boolean
  /** USD → CNY 汇率，价格与成本一律按人民币显示 */
  usdCny: number
  /** 汇率对应的日期，YYYY-MM-DD；取到当天值后不再重复请求 */
  usdCnyDate: string
  /** 本地入口 token，Ed25519 签名的 sk- 票据 */
  localToken: string
  /** 签发本地 token 的密钥对；没有时验签退回明文比较 */
  localKey: { kid: string; privateKey: string } | null
  /** 命名的接入 token，可多个，备注必填 */
  tokens: AccessToken[]
  /** 明细保留天数 */
  retentionDays: number
  /** 分钟聚合保留天数 */
  rollupRetentionDays: number
  overlay: OverlayState
  /** 悬浮窗不透明度 30-100 */
  overlayOpacity: number
  startMinimized: boolean
  /** 自动探活的间隔秒数，60–3600 */
  autoProbeIntervalSec: number
  /** 开机自启 */
  startAtLogin: boolean
  /** 启动与每天 00:00 自动校准汇率和自动价（手动价不动） */
  autoCalibrate: boolean
  /** 最近一次自动校准的结果 */
  lastCalibrate: { at: number; rate: number; updated: number; missed: number } | null
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
  /** 输入中未命中缓存、按输入原价计费的部分 */
  uncachedInputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheInputTokens: number
  cost: number
  currency: string
  /** 仅内存，给明细列表用；不落盘 */
  note?: string
}

/** 日志页的请求行：请求明细 + 当时的供应商名与上游模型 */
export interface RequestLog extends RequestEvent {
  providerName: string
  upstreamModel: string
}

export type AppLogLevel = 'info' | 'warn' | 'error'

/** 运行日志一行 */
export interface AppLog {
  id: string
  ts: number
  level: AppLogLevel
  scope: string
  message: string
}

export interface LogQuery {
  from: number
  to: number
  /** 请求日志专用 */
  modelId?: string
  source?: RequestSource
  ok?: boolean
  /** 两种日志共用 */
  keyword?: string
  level?: AppLogLevel
  page: number
  pageSize: number
}

export interface LogPage<T> {
  rows: T[]
  total: number
}

export interface TodayTotals {
  requests: number
  errors: number
  input: number
  uncachedInput: number
  output: number
  cacheRead: number
  cacheInput: number
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
  watch: boolean
  showRate: boolean
  buckets: number[]
  /** 每秒增量估算 token，供多模型实时曲线；估算值，不参与统计与计费 */
  deltaBuckets: number[]
  tps: number
  /** 首字后按增量估算的实时速率；首字前为 null */
  realtimeTps: number | null
  /** 今日缓存命中率，无输入 token 时为 null */
  hitRate: number | null
  today: TodayTotals
  lastError: string | null
  lastErrorAt: number | null
  lastTtftMs: number | null
  /** 最近一次成功请求的生成速率（tok/s）与时间 */
  lastTps: number | null
  lastTpsAt: number | null
  /** 今天的 TTFT 分位数（毫秒），无样本为 null */
  ttftP50: number | null
  ttftP95: number | null
  ttftP99: number | null
  /** 正在进行的请求数 */
  inflight: number
  /** 是否该显示流光：进行中，或开始后不足 1.5 秒 */
  active: boolean
  probing: boolean
  /** 自动探活开关与最近结果 */
  autoProbe: boolean
  lastProbeAt: number | null
  lastProbeOk: boolean | null
  probeFails: number
}

export interface SnapshotTotals {
  tps: number
  hitRate: number | null
  todayCost: number
  requests: number
  errors: number
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
  priceCacheInput: number
  currency: string
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
  settings: Omit<Settings, 'localToken' | 'tokens'> & {
    localTokenMasked: string
    localToken: string
    lanIp: string
    tokens: (AccessToken & { masked: string })[]
  }
  dataDir: string
  version: string
}

export interface ProviderTestResult {
  ok: boolean
  status: number
  message: string
}

/* ------------------------------- 分析接口 ------------------------------- */

export type StatsMetric = 'requests' | 'errors' | 'input' | 'uncached' | 'output' | 'total' | 'cache_read' | 'cost' | 'tps'
export type StatsGranularity = 'minute' | 'hour' | 'day'
export type StatsGroup = 'model' | 'provider' | 'token'
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
  uncached: number
  output: number
  /** 输入 + 输出 */
  total: number
  cacheRead: number
  cacheInput: number
  cost: number
  ttftP50: number | null
  ttftP95: number | null
  ttftP99: number | null
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
  modelReorder: 'model:reorder',
  priceLookup: 'model:price',
  rateRefresh: 'rate:refresh',
  probeRun: 'probe:run',
  probeStop: 'probe:stop',
  settingsUpdate: 'settings:update',
  tokenRotate: 'settings:rotateToken',
  tokenCreate: 'token:create',
  tokenDelete: 'token:delete',
  tokenUpdate: 'token:update',
  proxyRestart: 'proxy:restart',
  history: 'history:read',
  recent: 'history:recent',
  logRequests: 'log:requests',
  logApps: 'log:apps',
  openDataDir: 'app:openDataDir',
  backup: 'app:backup',
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
  calibrated: 'app:calibrated',
  calibrate: 'app:calibrate',
  devSeed: 'dev:seed'
} as const
