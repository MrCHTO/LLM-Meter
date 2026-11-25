import type { Settings } from '../../shared/types'
import type { SettingsPatch } from '../../shared/ipc/contract'
import * as cfg from '../store/config'
import { clampInt, clampRate } from '../../shared/limits'

/**
 * 设置写入的唯一入口。
 *
 * 校验、落盘、副作用通知都在这里：IPC、托盘、悬浮窗菜单只调 update()，
 * 由 index.ts 订阅 onChange 去重启代理、同步登录项、重画窗口。
 */

export interface SettingsChange {
  patch: SettingsPatch
  before: Settings
  after: Settings
  keys: (keyof SettingsPatch)[]
}

const listeners = new Set<(change: SettingsChange) => void>()

export function onChange(fn: (change: SettingsChange) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** 把 patch 写进设置。数值项按 shared/limits 钳制，布尔项照搬 */
export function applyPatch(settings: Settings, patch: SettingsPatch): void {
  if (patch.port !== undefined) settings.port = clampInt('port', patch.port)
  if (patch.allowLan !== undefined) settings.allowLan = patch.allowLan
  if (patch.usdCny !== undefined) settings.usdCny = clampRate(patch.usdCny)
  if (patch.retentionDays !== undefined) settings.retentionDays = clampInt('retentionDays', patch.retentionDays)
  if (patch.rollupRetentionDays !== undefined) {
    settings.rollupRetentionDays = clampInt('rollupRetentionDays', patch.rollupRetentionDays)
  }
  if (patch.overlayOpacity !== undefined) settings.overlayOpacity = clampInt('overlayOpacity', patch.overlayOpacity)
  if (patch.overlayWidth !== undefined) settings.overlay.width = clampInt('overlayWidth', patch.overlayWidth)
  if (patch.autoProbeIntervalSec !== undefined) {
    settings.autoProbeIntervalSec = clampInt('autoProbeIntervalSec', patch.autoProbeIntervalSec)
  }
  if (patch.startMinimized !== undefined) settings.startMinimized = patch.startMinimized
  if (patch.startAtLogin !== undefined) settings.startAtLogin = patch.startAtLogin
  if (patch.theme !== undefined) settings.theme = patch.theme
  if (patch.autoCalibrate !== undefined) settings.autoCalibrate = patch.autoCalibrate

  if (patch.overlayVisible !== undefined) settings.overlay.visible = patch.overlayVisible
  if (patch.overlayModelId !== undefined) settings.overlay.modelId = patch.overlayModelId || null
  if (patch.overlayGlobal !== undefined) settings.overlay.global = patch.overlayGlobal
  if (patch.overlayTheme !== undefined) settings.overlay.theme = patch.overlayTheme
  if (patch.overlayEffect !== undefined) settings.overlay.effect = patch.overlayEffect
  if (patch.overlaySpeed !== undefined) settings.overlay.speed = clampInt('overlaySpeed', patch.overlaySpeed)
  if (patch.overlayLocked !== undefined) settings.overlay.locked = patch.overlayLocked
  if (patch.overlaySnapCenter !== undefined) settings.overlay.snapCenter = patch.overlaySnapCenter
  if (patch.overlayShowProvider !== undefined) settings.overlay.showProvider = patch.overlayShowProvider
  if (patch.overlayShowModel !== undefined) settings.overlay.showModel = patch.overlayShowModel
  if (patch.overlayShowCost !== undefined) settings.overlay.showCost = patch.overlayShowCost
  if (patch.overlayX !== undefined && Number.isFinite(patch.overlayX)) {
    settings.overlay.x = Math.round(patch.overlayX)
  }
  if (patch.overlayY !== undefined && Number.isFinite(patch.overlayY)) {
    settings.overlay.y = Math.round(patch.overlayY)
  }
}

export function update(patch: SettingsPatch): void {
  const before = structuredClone(cfg.get().settings)
  const keys = Object.keys(patch) as (keyof SettingsPatch)[]
  let after: Settings = before
  cfg.mutate((c) => {
    applyPatch(c.settings, patch)
    after = structuredClone(c.settings)
  })
  const change: SettingsChange = { patch, before, after, keys }
  for (const fn of listeners) fn(change)
}
