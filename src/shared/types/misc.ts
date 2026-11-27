/** 通用返回形态与运行信息 */

export interface IpcResult<T> {
  ok: boolean
  data?: T
  error?: string
}

export interface AppInfo {
  version: string
  dataDir: string
  platform: string
}
