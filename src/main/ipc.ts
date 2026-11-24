import { app, dialog, ipcMain, screen, shell } from 'electron'
import { randomUUID } from 'node:crypto'
import { copyFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CH } from '../shared/types'
import type {
  ApiFormat,
  ConfigView,
  IpcResult,
  LogQuery,
  ModelCfg,
  ProbeResult,
  ProviderTestResult,
  RequestEvent,
  StatsExportResult,
  StatsGroup,
  StatsQuery,
  StatsRow,
  StatsSeries,
  StatsSeriesQuery
} from '../shared/types'
import * as cfg from './store/config'
import * as live from './store/live'
import * as db from './store/db'
import * as repo from './store/db/repo'
import * as applog from './applog'
import { dataDir, dayKey } from './store/paths'
import { mask, open as openKey, seal } from './security/keys'
import * as token from './security/token'
import * as probe from './probe/runner'
import * as proxy from './proxy/server'
import { adapterFor } from './proxy/adapters'
import { joinUrl } from './proxy/url'
import { lookup as lookupPrice } from './pricing'
import * as rate from './rate'
import * as calibrate from './calibrate'
import { lanIp } from './net'
import * as overlayWin from './windows/overlay'
import * as mainWindow from './windows/main-window'
import { showMain } from './windows/registry'

function ok<T>(data?: T): IpcResult<T> {
  return { ok: true, data }
}

function bad(error: string): IpcResult<never> {
  return { ok: false, error }
}

/** 日志页查询参数归一：时间窗必填，分页限幅，关键字截断 */
function logQuery(input: LogQuery | undefined): LogQuery {
  const q = input ?? ({} as LogQuery)
  const pageSize = Math.min(Math.max(Math.round(q.pageSize) || 100, 1), 200)
  const page = Math.max(Math.round(q.page) || 1, 1)
  const to = Number(q.to) || Date.now()
  const from = Number(q.from) || to - 24 * 3_600_000
  return {
    from: Math.min(from, to),
    to,
    modelId: q.modelId || undefined,
    source: q.source === 'probe' || q.source === 'proxy' ? q.source : undefined,
    ok: typeof q.ok === 'boolean' ? q.ok : undefined,
    keyword: (q.keyword ?? '').slice(0, 100),
    level: q.level === 'warn' || q.level === 'error' ? q.level : q.level === 'info' ? 'info' : undefined,
    page,
    pageSize
  }
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
      allowLan: c.settings.allowLan,
      lanIp: lanIp(),
      usdCny: c.settings.usdCny,
      usdCnyDate: c.settings.usdCnyDate,
      retentionDays: c.settings.retentionDays,
      rollupRetentionDays: c.settings.rollupRetentionDays,
      overlay: c.settings.overlay,
      overlayOpacity: c.settings.overlayOpacity,
      startMinimized: c.settings.startMinimized,
      startAtLogin: c.settings.startAtLogin,
      theme: c.settings.theme,
      autoCalibrate: c.settings.autoCalibrate,
      autoProbeIntervalSec: c.settings.autoProbeIntervalSec,
      lastCalibrate: c.settings.lastCalibrate,
      localToken: c.settings.localToken,
      localKey: c.settings.localKey,
      localTokenMasked: token.masked(c.settings.localToken),
      tokens: c.settings.tokens.map((t) => ({
        id: t.id,
        remark: t.remark,
        token: t.token,
        masked: token.masked(t.token),
        createdAt: t.createdAt
      }))
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

function validateAlias(alias: string, exceptId?: string): string {
  const value = alias.trim()
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
      const name = input.name.trim()
      if (!name) throw new Error('供应商名称必须填写')
      const id = randomUUID()
      cfg.mutate((c) => {
        c.providers.push({
          id,
          name,
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
          priceSource: input.priceSource === 'auto' ? 'auto' : 'manual',
          autoProbe: input.autoProbe === true,
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
        if (patch.autoProbe !== undefined) m.autoProbe = patch.autoProbe
        if (patch.watch !== undefined) m.watch = patch.watch
    if (patch.showRate !== undefined) m.showRate = patch.showRate
        if (patch.priceIn !== undefined) m.priceIn = Math.max(0, patch.priceIn)
        if (patch.priceOut !== undefined) m.priceOut = Math.max(0, patch.priceOut)
        if (patch.priceCacheRead !== undefined) m.priceCacheRead = Math.max(0, patch.priceCacheRead)
        if (patch.priceCacheInput !== undefined) m.priceCacheInput = Math.max(0, patch.priceCacheInput)
        if (patch.cacheInputSupported !== undefined) m.cacheInputSupported = patch.cacheInputSupported
        if (patch.currency !== undefined) m.currency = patch.currency || 'USD'
        // 显式给了 priceSource 就照办（恢复自动）；否则只要动过价格就判为手动
        if (patch.priceSource !== undefined) m.priceSource = patch.priceSource === 'auto' ? 'auto' : 'manual'
        else if (
          patch.priceIn !== undefined ||
          patch.priceOut !== undefined ||
          patch.priceCacheRead !== undefined ||
          patch.priceCacheInput !== undefined
        ) {
          m.priceSource = 'manual'
        }
      })
      return true
    })
  )

  ipcMain.handle(
    CH.modelReorder,
    wrap((ids: string[]) => {
      cfg.mutate((c) => {
        const order = new Map(ids.map((id, i) => [id, i]))
        for (const m of c.models) m.sort = order.get(m.id) ?? m.sort + ids.length
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
    wrap(async (modelId: string, providerId?: string) => {
      // 同时探测一次上游 usage 是否带缓存写入字段，决定界面是否允许填写入价
      const probeCacheWrite = async (): Promise<{ probed: boolean; reported: boolean }> => {
        if (!providerId) return { probed: false, reported: false }
        const p = cfg.providerById(providerId)
        if (!p) return { probed: false, reported: false }
        const key = openKey(p.keyCipher)
        if (!key) return { probed: false, reported: false }
        const adapter = adapterFor(p.format)
        const prepared = adapter.prepare(
          { model: modelId, messages: [{ role: 'user', content: 'hi' }], max_tokens: 1, stream: false },
          modelId
        )
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), 15_000)
        try {
          const res = await fetch(joinUrl(p.baseUrl, `/v1/${p.format === 'anthropic' ? 'messages' : 'chat/completions'}`), {
            method: 'POST',
            headers: { ...adapter.baseHeaders(), ...adapter.auth(key) },
            body: prepared.body,
            signal: controller.signal
          })
          if (!res.ok) return { probed: false, reported: false }
          const parsed = adapter.parseUsage(await res.text())
          return { probed: true, reported: parsed?.reportedCacheInput === true }
        } catch {
          return { probed: false, reported: false }
        } finally {
          clearTimeout(timer)
        }
      }

      const [out, capability] = await Promise.all([lookupPrice(modelId), probeCacheWrite()])
      const cached = { cacheWriteProbed: capability.probed, cacheWriteReported: capability.reported }
      if (!out.found) return { ...out, ...cached }
      // 价源报的是美元，按当天汇率折成人民币再给界面
      const today = await rate.current()
      const conv = (v?: number): number | undefined =>
        v === undefined ? undefined : Math.round(v * today.rate * 1e6) / 1e6
      return {
        ...out,
        ...cached,
        priceIn: conv(out.priceIn),
        priceOut: conv(out.priceOut),
        priceCacheRead: conv(out.priceCacheRead),
        priceCacheInput: conv(out.priceCacheInput),
        note: `已按照 ${out.matchedId} 查询并自动填写${
          out.source === 'official' ? '（官方价）' : '（OpenRouter 最低服务商价）'
        }，人民币汇率为 ${today.rate.toFixed(2)}${out.exact ? '' : '（近似匹配，请核对）'}`
      }
    })
  )
  ipcMain.handle(CH.rateRefresh, wrap(() => rate.refresh()))
  ipcMain.handle(CH.calibrate, wrap(() => calibrate.run()))
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
        startMinimized?: boolean
        overlayWidth?: number
        overlayVisible?: boolean
        overlayModelId?: string | null
        overlayGlobal?: boolean
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
      }) => {
        cfg.mutate((c) => {
          if (patch.port !== undefined) c.settings.port = Math.min(65535, Math.max(1024, Math.round(patch.port)))
          if (patch.allowLan !== undefined) c.settings.allowLan = patch.allowLan
          if (patch.usdCny !== undefined) c.settings.usdCny = Math.min(20, Math.max(1, patch.usdCny))
          if (patch.retentionDays !== undefined) c.settings.retentionDays = Math.max(1, Math.round(patch.retentionDays))
          if (patch.rollupRetentionDays !== undefined) {
            c.settings.rollupRetentionDays = Math.max(1, Math.round(patch.rollupRetentionDays))
          }
          if (patch.overlayOpacity !== undefined) {
            c.settings.overlayOpacity = Math.min(100, Math.max(10, Math.round(patch.overlayOpacity)))
          }
          if (patch.startMinimized !== undefined) c.settings.startMinimized = patch.startMinimized
          if (patch.overlayWidth !== undefined) c.settings.overlay.width = Math.min(720, Math.max(240, Math.round(patch.overlayWidth)))
          if (patch.overlayVisible !== undefined) c.settings.overlay.visible = patch.overlayVisible
          if (patch.overlayModelId !== undefined) c.settings.overlay.modelId = patch.overlayModelId || null
          if (patch.overlayGlobal !== undefined) c.settings.overlay.global = patch.overlayGlobal
          if (patch.overlayX !== undefined) c.settings.overlay.x = Math.round(patch.overlayX)
          if (patch.overlayY !== undefined) c.settings.overlay.y = Math.round(patch.overlayY)
          if (patch.overlayTheme !== undefined) c.settings.overlay.theme = patch.overlayTheme
          if (patch.overlayLocked !== undefined) c.settings.overlay.locked = patch.overlayLocked
          if (patch.overlayShowProvider !== undefined) c.settings.overlay.showProvider = patch.overlayShowProvider
          if (patch.overlayShowModel !== undefined) c.settings.overlay.showModel = patch.overlayShowModel
          if (patch.overlayShowCost !== undefined) c.settings.overlay.showCost = patch.overlayShowCost
          if (patch.startAtLogin !== undefined) c.settings.startAtLogin = patch.startAtLogin
          if (patch.theme !== undefined) c.settings.theme = patch.theme
          if (patch.autoCalibrate !== undefined) c.settings.autoCalibrate = patch.autoCalibrate
          if (patch.autoProbeIntervalSec !== undefined) {
            c.settings.autoProbeIntervalSec = Math.min(3600, Math.max(60, Math.round(patch.autoProbeIntervalSec)))
          }
        })
        overlayWin.applySettings()
        if (patch.overlayX !== undefined || patch.overlayY !== undefined) {
          const ov = cfg.get().settings.overlay
          if (ov.x !== null && ov.y !== null) overlayWin.moveTo(ov.x, ov.y)
        }
        if (patch.overlayVisible !== undefined) overlayWin.setVisible(patch.overlayVisible)
        if (patch.theme !== undefined) mainWindow.applyTheme()
        // 端口 / 局域网开关变化后的代理重启统一由 index.ts 的 cfg.onChange 处理
        return true
      }
    )
  )

  ipcMain.handle(
    CH.tokenRotate,
    wrap(() => {
      const issued = token.issue()
      cfg.mutate((c) => {
        c.settings.localKey = issued.key
        c.settings.localToken = issued.token
      })
      return issued.token
    })
  )

  ipcMain.handle(
    CH.tokenCreate,
    wrap((remarkInput: string) => {
      const remark = String(remarkInput ?? '').trim()
      if (!remark) throw new Error('备注必须填写')
      if (remark.length > 40) throw new Error('备注最长 40 个字')
      if (cfg.get().settings.tokens.some((t) => t.remark === remark)) throw new Error(`备注 ${remark} 已存在`)
      const issued = token.issue()
      const created = { id: randomUUID(), remark, token: issued.token, createdAt: Date.now() }
      cfg.mutate((c) => {
        c.settings.tokens.push(created)
      })
      return { ...created, masked: token.masked(created.token) }
    })
  )

  ipcMain.handle(
    CH.tokenDelete,
    wrap((id: string) => {
      const list = cfg.get().settings.tokens
      if (list.length <= 1) throw new Error('至少保留一个 token')
      cfg.mutate((c) => {
        c.settings.tokens = c.settings.tokens.filter((t) => t.id !== id)
      })
      return true
    })
  )

  ipcMain.handle(
    CH.tokenUpdate,
    wrap((id: string, remarkInput: string) => {
      const remark = String(remarkInput ?? '').trim()
      if (!remark) throw new Error('备注必须填写')
      if (remark.length > 40) throw new Error('备注最长 40 个字')
      const list = cfg.get().settings.tokens
      const target = list.find((t) => t.id === id)
      if (!target) throw new Error('token 不存在')
      if (list.some((t) => t.id !== id && t.remark === remark)) throw new Error(`备注 ${remark} 已存在`)
      const from = target.remark
      cfg.mutate((c) => {
        const t = c.settings.tokens.find((x) => x.id === id)
        if (t) t.remark = remark
      })
      // 备注变了，历史明细按 token_id 改名，聚合从明细整表重建
      if (from !== remark) {
        repo.renameTokenRemark(db.get(), id, from, remark)
        applog.info('access', `Token 备注改名 ${from} → ${remark}，历史与聚合已跟随`)
      }
      return true
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
    wrap((days: number, modelId: string | null) => repo.daySeries(db.get(), Math.min(365, Math.max(1, days)), modelId))
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
      // 配置 JSON 原样拷走，数据库用 VACUUM INTO 取一致性快照
      const stamp = Date.now()
      const configTarget = join(dataDir(), `config.backup-${stamp}.json`)
      copyFileSync(join(dataDir(), 'config.json'), configTarget)
      const dbTarget = join(dataDir(), `data.backup-${stamp}.db`)
      repo.backupTo(db.get(), dbTarget)
      return `${configTarget}（数据库快照 ${dbTarget}）`
    })
  )

  ipcMain.handle(
    CH.recent,
    wrap((modelId: string, limit?: number) => live.recentFor(modelId, limit ?? 20))
  )

  ipcMain.handle(CH.logRequests, wrap((input: LogQuery) => repo.queryRequests(db.get(), logQuery(input))))
  ipcMain.handle(CH.logApps, wrap((input: LogQuery) => repo.queryAppLogs(db.get(), logQuery(input))))

  const pruneNow = (): number => {
    const s = cfg.get().settings
    return repo.prune(db.get(), Date.now(), s.retentionDays, s.rollupRetentionDays).requests
  }

  ipcMain.handle(
    CH.exportDaily,
    wrap(() => pruneNow())
  )

  ipcMain.handle(
    CH.eventsCleanup,
    wrap(() => {
      pruneNow()
      return true
    })
  )

  // 分析
  const labelOf = (group: StatsGroup, key: string): string => {
    if (group === 'token') return key || '（未记录）'
    if (!key) return '（已删除）'
    const found = group === 'model' ? cfg.modelById(key)?.alias : cfg.providerById(key)?.name
    if (found) return found
    // 配置里删掉后，用历史行里的快照名兜底
    const row =
      group === 'model'
        ? db.get().get<{ v: string }>("select alias v from requests where model_id = ? and alias <> '' limit 1", key)
        : db
            .get()
            .get<{ v: string }>(
              "select provider_name v from requests where provider_id = ? and provider_name <> '' limit 1",
              key
            )
    return row?.v ?? key
  }

  const mapRow = (group: StatsGroup) => (r: repo.GroupTotals): StatsRow => ({
    key: r.key,
    label: labelOf(group, r.key),
    requests: r.requests,
    errors: r.errors,
    input: r.input,
    uncached: r.uncached,
    output: r.output,
    total: r.total,
    cacheRead: r.cache_read,
    cacheInput: r.cache_input,
    cacheInputReported: r.cache_input_reported,
    cacheReadReported: r.cache_read_reported,
    cost: r.cost,
    ttftP50: r.ttft_p50,
    ttftP95: r.ttft_p95,
    ttftP99: r.ttft_p99,
    tps: r.tps
  })

  ipcMain.handle(
    CH.statsSeries,
    wrap((q: StatsSeriesQuery): StatsSeries => {
      const out = repo.series(db.get(), q)
      return {
        buckets: out.buckets,
        series: out.series.map((s) => ({ key: s.key, label: labelOf(q.groupBy, s.key), points: s.points }))
      }
    })
  )

  ipcMain.handle(
    CH.statsTotals,
    wrap((q: StatsQuery & { groupBy: StatsGroup }): StatsRow[] =>
      repo.totals(db.get(), q).map(mapRow(q.groupBy))
    )
  )

  ipcMain.handle(
    CH.statsTop,
    wrap((q: StatsQuery & { by: 'cost' | 'requests' | 'output'; limit: number }): StatsRow[] =>
      repo.top(db.get(), q).map(mapRow('model'))
    )
  )

  ipcMain.handle(
    CH.statsExport,
    wrap(async (q: StatsQuery): Promise<StatsExportResult> => {
      const rows = repo.exportRange(db.get(), q.from, q.to, q.source)
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
      const picked = await dialog.showSaveDialog({
        title: '导出区间明细',
        defaultPath: join(app.getPath('downloads'), `llm-meter-${stamp}.csv`),
        filters: [{ name: 'CSV', extensions: ['csv'] }]
      })
      if (picked.canceled || !picked.filePath) throw new Error('已取消')
      const head = [
        '时间',
        '来源',
        '模型',
        '上游模型',
        '供应商',
        'Token 备注',
        '地址',
        '状态',
        'ok',
        'TTFT(ms)',
        '耗时(ms)',
        '总输入',
        '未缓存输入',
        '缓存读取',
        '缓存输入',
        '输出',
        '总 token',
        '成本',
        '货币',
        '备注'
      ]
      const cell = (v: unknown): string => `"${String(v ?? '').replace(/"/g, '""')}"`
      const lines = [head.join(',')]
      for (const r of rows) {
        lines.push(
          [
            new Date(r.ts).toISOString(),
            r.source,
            r.alias,
            r.upstream_model,
            r.provider_name,
            r.token_remark ?? '',
            r.base_url,
            r.status,
            r.ok,
            r.ttft_ms ?? '',
            r.duration_ms,
            r.input_tokens,
            r.uncached_input_tokens,
            Number(r.cache_read_reported) ? r.cache_read_tokens : '',
            r.cache_input_tokens,
            r.output_tokens,
            Number(r.input_tokens) + Number(r.output_tokens),
            r.cost,
            r.currency,
            r.note ?? ''
          ]
            .map(cell)
            .join(',')
        )
      }
      writeFileSync(picked.filePath, `\ufeff${lines.join('\n')}`, 'utf8')
      return { path: picked.filePath, rows: rows.length }
    })
  )

  ipcMain.handle(
    CH.devSeed,
    wrap((count: number) => {
      const models = cfg.listModels().filter((m) => m.enabled)
      if (models.length === 0) throw new Error('先配置模型')
      const now = Date.now()
      let made = 0
      for (let i = 0; i < count; i++) {
        const model = models[i % models.length] as ModelCfg
        const provider = cfg.providerById(model.providerId)
        if (!provider) continue
        const ts = now - Math.floor((i / count) * 6 * 3_600_000) - Math.floor(Math.random() * 30_000)
        const input = 400 + Math.floor(Math.random() * 3000)
        const output = 40 + Math.floor(Math.random() * 500)
        const cacheRead = Math.floor(input * (Math.random() * 0.9))
        const duration = 600 + Math.floor(Math.random() * 4000)
        const ev: RequestEvent = {
          id: `seed-${ts}-${i}`,
          ts,
          source: Math.random() < 0.15 ? 'probe' : 'proxy',
          modelId: model.id,
          alias: model.alias,
          providerId: provider.id,
          status: 200,
          ok: true,
          errorKind: null,
          stream: true,
          ttftMs: 120 + Math.floor(Math.random() * 900),
          durationMs: duration,
          inputTokens: input,
          uncachedInputTokens: Math.max(0, input - cacheRead),
          outputTokens: output,
          cacheReadTokens: cacheRead,
          cacheInputTokens: 0,
          cacheInputReported: false,
          cacheReadReported: cacheRead > 0,
          cost: (Math.max(0, input - cacheRead) * model.priceIn + output * model.priceOut + cacheRead * model.priceCacheRead) / 1e6,
          currency: model.currency
        }
        repo.recordRequest(db.get(), ev, {
          day: dayKey(ts),
          providerName: provider.name,
          baseUrl: provider.baseUrl,
          upstreamModel: model.upstreamModel,
          priceIn: model.priceIn,
          priceOut: model.priceOut,
          priceCacheRead: model.priceCacheRead,
          priceCacheInput: model.priceCacheInput
        })
        made++
      }
      return made
    })
  )

  // 悬浮窗
  ipcMain.handle(CH.overlayDragStart, wrap(() => overlayWin.startDrag()))
  ipcMain.handle(CH.overlayDragEnd, wrap(() => overlayWin.stopDrag()))
  ipcMain.handle(CH.overlayHover, wrap((value: boolean) => overlayWin.setHover(value)))
  ipcMain.handle(CH.overlayMenu, wrap(() => overlayWin.showMenu()))
  ipcMain.handle(CH.overlayOpenMain, wrap(() => showMain()))
  ipcMain.handle(CH.overlaySetSize, wrap((width: number, height: number) => overlayWin.resize(width, height)))
  ipcMain.handle(
    CH.overlayState,
    wrap(() => {
      const bounds = overlayWin.bounds()
      if (!bounds) return null
      return { bounds, area: screen.getDisplayMatching(bounds).workArea, opacity: cfg.get().settings.overlayOpacity }
    })
  )
  ipcMain.handle(CH.mainOpen, wrap(() => showMain()))
}
