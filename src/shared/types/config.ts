/** 供应商、模型、设置与配置视图 */

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
  /** 探测结果：上游是否上报缓存输入字段；null 未知 */
  cacheInputSupported: boolean | null
  currency: string
  /** 价格来源：自动校准的会被每天刷新，手动改过的不动 */
  priceSource: 'auto' | 'manual'
  /** 自动探活：开启后按设置的间隔向该模型发极轻请求 */
  autoProbe: boolean
  sort: number
  createdAt: number
}

/** 悬浮窗进行中的边框效果 */
export type OverlayEffect = 'rainbow' | 'comet' | 'duo' | 'glow' | 'dot'

/** 效果清单：顺序即设置页展示顺序，label 只给界面用 */
export const OVERLAY_EFFECTS: { id: OverlayEffect; label: string }[] = [
  { id: 'rainbow', label: '彩虹流动' },
  { id: 'comet', label: '彗星扫光' },
  { id: 'duo', label: '双色流动' },
  { id: 'glow', label: '外发光' },
  { id: 'dot', label: '状态点脉冲' }
]

export function isOverlayEffect(value: unknown): value is OverlayEffect {
  return OVERLAY_EFFECTS.some((e) => e.id === value)
}

export interface OverlayState {
  x: number | null
  y: number | null
  width: number
  visible: boolean
  /** 胶囊盯住的模型，null 表示还没选 */
  modelId: string | null
  /** 盯全部启用模型的合计数据，优先于 modelId */
  global: boolean
  /** 锁定后拖不动，防误碰 */
  locked: boolean
  /** 拖到屏幕横/纵中线附近时自动吸附 */
  snapCenter: boolean
  /** 胶囊外观：黑色 / 白色 */
  theme: 'dark' | 'light'
  /** 请求进行中的边框效果 */
  effect: OverlayEffect
  /** 效果速度，百分比；100 为基准速度 */
  speed: number
  /** 胶囊上是否显示供应商名称 */
  showProvider: boolean
  /** 胶囊上是否显示模型名称 */
  showModel: boolean
  /** 胶囊上是否显示今日费用 */
  showCost: boolean
}

export interface AccessToken {
  id: string
  /** 用途备注，必填，也是分析里的分组名 */
  remark: string
  /** 完整 token，界面点一下即可复制 */
  token: string
  createdAt: number
}

/** 主窗口主题；system 跟随系统 */
export type ThemeMode = 'light' | 'dark' | 'system'

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
  /** 悬浮窗不透明度 10-100 */
  overlayOpacity: number
  startMinimized: boolean
  /** 自动探活的间隔秒数，60–3600 */
  autoProbeIntervalSec: number
  /** 开机自启 */
  startAtLogin: boolean
  /** 主窗口主题 */
  theme: ThemeMode
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

export interface ProviderInput {
  name: string
  baseUrl: string
  format: ApiFormat
  apiKey: string
  enabled: boolean
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
