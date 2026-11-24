import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import type { ApiFormat, ConfigView } from '../../shared/types'
import * as cfg from '../store/config'
import { dataDir } from '../store/paths'
import { mask, open as openKey, seal } from '../security/keys'
import * as token from '../security/token'
import { lanIp } from '../net'
import { testProvider as runTest } from '../probe/provider-test'
import { handle, wrap } from './shared'

function needBaseUrl(raw: string): string {
  const value = raw.trim().replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(value)) throw new Error('Base URL 需要以 http:// 或 https:// 开头')
  return value
}

/** 渲染层的配置视图：供应商只给掩码，token 只给脱敏回显 */
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

export function register(): void {
  handle(
    'config',
    wrap(() => view())
  )

  handle(
    'createProvider',
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

  handle(
    'updateProvider',
    wrap(
      (id: string, patch: { name?: string; baseUrl?: string; format?: ApiFormat; apiKey?: string; enabled?: boolean }) => {
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
      }
    )
  )

  handle(
    'deleteProvider',
    wrap((id: string) => {
      cfg.mutate((c) => {
        c.models = c.models.filter((m) => m.providerId !== id)
        c.providers = c.providers.filter((p) => p.id !== id)
      })
      return true
    })
  )

  handle(
    'testProvider',
    wrap((id: string) => runTest(id))
  )
}
