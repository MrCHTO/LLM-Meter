/** 测速与连通性结果 */

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

export interface ProviderTestResult {
  ok: boolean
  status: number
  message: string
}
