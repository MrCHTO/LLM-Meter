import { app, ipcMain, shell } from 'electron'
import { randomUUID } from 'node:crypto'
import { copyFileSync } from 'node:fs'
import { join } from 'node:path'
import { CH } from '../shared/types'
import type {
  ApiFormat,
  ConfigView,
  IpcResult,
  ModelCfg,
  ProbeResult,
  ProviderTestResult
} from '../shared/types'
import * as cfg from './store/config'
import * as live from './store/live'
import * as rollup from './store/rollup'
import * as events from './store/events'
import { dataDir } from './store/paths'
import { mask, open as openKey, seal } from './security/keys'
import * as token from './security/token'
import * as probe from './probe/runner'
import * as proxy from './proxy/server'
import { joinUrl } from './proxy/url'
import { lookup as lookupPrice } from './pricing'
import * as rate from './rate'
import * as overlayWin from './windows/overlay'
import { showMain } from './windows/registry'

function ok<T>(data?: T): IpcResult<T> {
  return { ok: true, data }
}

function bad(error: string): IpcResult<never> {
  return { ok: false, error }
}

function wrap<A extends unknown[], T>(fn: (...args: A) => T | Promise<T>) {
  return async (_e: Electron.IpcMainInvokeEvent, ...args: A): Promise<IpcResult<T>> => {
    try {
      return ok(await fn(...args))
    } catch (err) {
      console.error('[ipc]', err)
      return bad(err instanceof Error ? err.message : '操作失败')
    }
  }
}

function view(): ConfigView {
  const c = cfg.get()
  return {
    providers: cfg.listProviders().map((p) => {
      const { keyCipher, ...rest } = p
      const plain = openKey(keyCipher)
      return { ...rest, hasKey: Boolean(plain), keyMasked: mask(plain) }
    }),
    models: cfg.listModels(),
    settings: {
      port: c.settings.port,
      usdCny: c.settings.usdCny,
      usdCnyDate: c.settings.usdCnyDate,
      retentionDays: c.settings.retentionDays,
      rollupRetentionDays: c.settings.rollupRetentionDays,
      overlay: c.settings.overlay,
      overlayOpacity: c.settings.overlayOpacity,
      pauseProbe: c.settings.pauseProbe,
      startMinimized: c.settings.startMinimized,
      localToken: c.settings.localToken,
      localTokenMasked: token.masked(c.settings.localToken)
    },
    dataDir: dataDir(),
    version: app.getVersion()
  }
}

function needBaseUrl(raw: string): string {
  const value = raw.trim().replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(value)) throw new Error('Base URL 需要以 http:// 或 https:// 开头')
  return value
}

/** 上游错误体通常是 JSON，取里面的 message，取不到就退回原文 */
function readable(text: string, status: number): string {
  try {
    const parsed = JSON.parse(text) as { error?: { message?: unknown }; message?: unknown }
    const msg = parsed.error?.message ?? parsed.message
    if (typeof msg === 'string' && msg) return msg
  } catch {
    /* 不是 JSON */
  }
  return text.slice(0, 200) || `HTTP ${status}`
}

function validateAlias(alias: string, exceptId?: string): string {  const value = alias.trim()
  if (!value) throw new Error('别名不能为空')
  if (/\s/.test(value)) throw new Error('别名不能含空格')
  const dup = cfg.modelByAlias(value)
  if (dup && dup.id !== exceptId) throw new Error(`别名 ${value} 已被占用`)
  return value
}

export function register(): void {
  ipcMain.handle(CH.config, wrap(() => view()))

  ipcMain.handle(
    CH.providerCreate,
    wrap((input: { name: string; baseUrl: string; format: ApiFormat; apiKey: string; enabled: boolean }) => {
      const baseUrl = needBaseUrl(input.baseUrl)
      const id = randomUUID()
      cfg.mutate((c) => {
        c.providers.push({
          id,
          name: input.name.trim() || baseUrl,
          baseUrl,
          format: input.format === 'anthropic' ? 'anthropic' : 'openai',
          keyCipher: seal(input.apiKey.trim()),
          enabled: input.enabled !== false,
          createdAt: Date.now()
        })
      })
      return id
    })
  )

  ipcMain.handle(
    CH.providerUpdate,
    wrap((id: string, patch: { name?: string; baseUrl?: string; format?: ApiFormat; apiKey?: string; enabled?: boolean }) => {
      cfg.mutate((c) => {
        const p = c.providers.find((x) => x.id === id)
        if (!p) throw new Error('供应商不存在')
        if (patch.name !== undefined) p.name = patch.name.trim() || p.name
        if (patch.baseUrl !== undefined) p.baseUrl = needBaseUrl(patch.baseUrl)
        if (patch.format !== undefined) p.format = patch.format === 'anthropic' ? 'anthropic' : 'openai'
        if (patch.enabled !== undefined) p.enabled = patch.enabled
        if (patch.apiKey !== undefined && patch.apiKey.trim()) p.keyCipher = seal(patch.apiKey.trim())
      })
      return true
    })
  )

  ipcMain.handle(
    CH.providerDelete,
    wrap((id: string) => {
      cfg.mutate((c) => {
        c.models = c.models.filter((m) => m.providerId !== id)
        c.providers = c.providers.filter((p) => p.id !== id)
      })
      return true
    })
  )

  ipcMain.handle(
    CH.providerTest,
    wrap(async (id: string): Promise<ProviderTestResult> => {
      const p = cfg.providerById(id)
      if (!p) throw new Error('供应商不存在')
      const key = openKey(p.keyCipher)
      if (!key) throw new Error('先填 API Key')
      const headers: Record<string, string> =
        p.format === 'anthropic'
          ? { 'x-api-key': key, 'anthropic-version': '2023-06-01' }
          : { authorization: `Bearer ${key}` }
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 20_000)
      try {
        // Base URL 可能已经写到 /v1，交给 joinUrl 去重
        const res = await fetch(joinUrl(p.baseUrl, '/v1/models'), { headers, signal: controller.signal })
        const text = await res.text()
        let message = res.ok ? '连通，Key 可读' : readable(text, res.status)
        if (res.status === 401 || res.status === 403) message = 'Key 被拒绝'
        else if (res.status === 404) message = '连通，但该站没有 /v1/models（不影响使用）'
        return { ok: res.ok || res.status === 404, status: res.status, message }
      } catch (err) {
        return {
          ok: false,
          status: 0,
          message: controller.signal.aborted ? '超时' : err instanceof Error ? err.message : '连接失败'
        }
      } finally {
        clearTimeout(timer)
      }
    })
  )

  ipcMain.handle(
    CH.modelCreate,
    wrap((input: Omit<ModelCfg, 'id' | 'createdAt' | 'sort'>) => {
      const alias = validateAlias(input.alias)
      const provider = cfg.providerById(input.providerId)
      if (!provider) throw new Error('供应商不存在')
      if (!input.upstreamModel.trim()) throw new Error('上游模型名不能为空')
      const id = randomUUID()
      cfg.mutate((c) => {
        c.models.push({
          ...input,
          id,
          alias,
          upstreamModel: input.upstreamModel.trim(),
          currency: input.currency || 'USD',
          sort: c.models.length,
          createdAt: Date.now()
        })
      })
      return id
    })
  )

  ipcMain.handle(
    CH.modelUpdate,
    wrap((id: string, patch: Partial<ModelCfg>) => {
      cfg.mutate((c) => {
        const m = c.models.find((x) => x.id === id)
        if (!m) throw new Error('模型不存在')
        if (patch.alias !== undefined) m.alias = validateAlias(patch.alias, id)
        if (patch.upstreamModel !== undefined) {
          if (!patch.upstreamModel.trim()) throw new Error('上游模型名不能为空')
          m.upstreamModel = patch.upstreamModel.trim()
        }
        if (patch.providerId !== undefined) {
          if (!cfg.providerById(patch.providerId)) throw new Error('供应商不存在')
          m.providerId = patch.providerId
        }
        if (patch.enabled !== undefined) m.enabled = patch.enabled
        if (patch.watch !== undefined) m.watch = patch.watch
        if (patch.priceIn !== undefined) m.priceIn = Math.max(0, patch.priceIn)
        if (patch.priceOut !== undefined) m.priceOut = Math.max(0, patch.priceOut)
        if (patch.priceCacheRead !== undefined) m.priceCacheRead = Math.max(0, patch.priceCacheRead)
        if (patch.priceCacheWrite !== undefined) m.priceCacheWrite = Math.max(0, patch.priceCacheWrite)
        if (patch.currency !== undefined) m.currency = patch.currency || 'USD'
        if (patch.dailyBudget !== undefined) m.dailyBudget = patch.dailyBudget && patch.dailyBudget > 0 ? patch.dailyBudget : null
      })
      return true
    })
  )

  ipcMain.handle(
    CH.modelDelete,
    wrap((id: string) => {
      cfg.mutate((c) => {
        c.models = c.models.filter((m) => m.id !== id)
      })
      return true
    })
  )

  ipcMain.handle(
    CH.priceLookup,
    wrap(async (modelId: string) => {
      const out = await lookupPrice(modelId)
      if (!out.found) return out
      // OpenRouter 报的是美元，按当天汇率折成人民币再给界面
      const today = await rate.current()
      const conv = (v?: number): number | undefined =>
        v === undefined ? undefined : Math.round(v * today.rate * 1e6) / 1e6
      return {
        ...out,
        priceIn: conv(out.priceIn),
        priceOut: conv(out.priceOut),
        priceCacheRead: conv(out.priceCacheRead),
        priceCacheWrite: conv(out.priceCacheWrite),
        note: `已按照 ${out.matchedId} 查询并自动填写，人名币汇率为 ${today.rate}${out.exact ? '' : '（近似匹配，请核对）'}`
      }
    })
  )
  ipcMain.handle(CH.rateRefresh, wrap(() => rate.refresh()))
  ipcMain.handle(CH.probeRun, wrap((id: string): Promise<ProbeResult> => probe.run(id)))
  ipcMain.handle(CH.probeStop, wrap((id?: string) => probe.stop(id)))

  ipcMain.handle(
    CH.settingsUpdate,
    wrap(
      async (patch: {
        port?: number
        usdCny?: number
        retentionDays?: number
        rollupRetentionDays?: number
        overlayOpacity?: number
        pauseProbe?: boolean
        startMinimized?: boolean
        overlayWidth?: number
        overlayVisible?: boolean
      }) => {
        const portChanged = patch.port !== undefined && patch.port !== cfg.get().settings.port
        cfg.mutate((c) => {
          if (patch.port !== undefined) c.settings.port = Math.min(65535, Math.max(1024, Math.round(patch.port)))
          if (patch.usdCny !== undefined) c.settings.usdCny = Math.min(20, Math.max(1, patch.usdCny))
          if (patch.retentionDays !== undefined) c.settings.retentionDays = Math.max(1, Math.round(patch.retentionDays))
          if (patch.rollupRetentionDays !== undefined) {
            c.settings.rollupRetentionDays = Math.max(1, Math.round(patch.rollupRetentionDays))
          }
          if (patch.overlayOpacity !== undefined) {
            c.settings.overlayOpacity = Math.min(100, Math.max(30, Math.round(patch.overlayOpacity)))
          }
          if (patch.pauseProbe !== undefined) c.settings.pauseProbe = patch.pauseProbe
          if (patch.startMinimized !== undefined) c.settings.startMinimized = patch.startMinimized
          if (patch.overlayWidth !== undefined) c.settings.overlay.width = Math.min(720, Math.max(240, Math.round(patch.overlayWidth)))
          if (patch.overlayVisible !== undefined) c.settings.overlay.visible = patch.overlayVisible
        })
        overlayWin.applySettings()
        if (patch.overlayVisible !== undefined) overlayWin.setVisible(patch.overlayVisible)
        if (portChanged) await proxy.start(cfg.get().settings.port)
        return true
      }
    )
  )

  ipcMain.handle(
    CH.tokenRotate,
    wrap(() => {
      let next = ''
      cfg.mutate((c) => {
        c.settings.localToken = token.generate()
        next = c.settings.localToken
      })
      return next
    })
  )

  ipcMain.handle(
    CH.proxyRestart,
    wrap(async () => {
      const state = await proxy.start(cfg.get().settings.port)
      return state
    })
  )

  ipcMain.handle(
    CH.history,
    wrap((days: number, modelId: string | null) => rollup.history(Math.min(365, Math.max(1, days)), modelId))
  )

  ipcMain.handle(
    CH.info,
    wrap(() => ({ version: app.getVersion(), dataDir: dataDir(), platform: process.platform }))
  )

  ipcMain.handle(
    CH.openDataDir,
    wrap(async () => {
      await shell.openPath(dataDir())
      return true
    })
  )

  ipcMain.handle(
    CH.backup,
    wrap(() => {
      const target = join(dataDir(), `config.backup-${Date.now()}.json`)
      copyFileSync(join(dataDir(), 'config.json'), target)
      return target
    })
  )

  ipcMain.handle(
    CH.recent,
    wrap((modelId: string, limit?: number) => live.recentFor(modelId, limit ?? 20))
  )

  ipcMain.handle(CH.probePause, wrap((value: boolean) => {
    cfg.mutate((c) => {
      c.settings.pauseProbe = value
    })
    return true
  }))

  ipcMain.handle(CH.exportDaily, wrap(() => {
    rollup.flush()
    return join(dataDir(), 'rollup')
  }))

  ipcMain.handle(CH.eventsCleanup, wrap(() => {
    events.cleanup(cfg.get().settings.retentionDays)
    return true
  }))

  // 悬浮窗
  ipcMain.handle(CH.overlayDragStart, wrap(() => overlayWin.startDrag()))
  ipcMain.handle(CH.overlayDragEnd, wrap(() => overlayWin.stopDrag()))
  ipcMain.handle(CH.overlayHover, wrap((value: boolean) => overlayWin.setHover(value)))
  ipcMain.handle(CH.overlayMenu, wrap(() => overlayWin.showMenu()))
  ipcMain.handle(CH.overlayOpenMain, wrap(() => showMain()))
  ipcMain.handle(CH.overlaySetHeight, wrap((height: number) => overlayWin.resizeHeight(height)))
  ipcMain.handle(CH.mainOpen, wrap(() => showMain()))
}
