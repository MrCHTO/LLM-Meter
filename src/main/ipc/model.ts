import { randomUUID } from 'node:crypto'
import type { ModelCfg } from '../../shared/types'
import * as cfg from '../store/config'
import * as probe from '../probe/runner'
import { quote } from '../pricing/quote'
import { handle, wrap } from './shared'

function validateAlias(alias: string, exceptId?: string): string {
  const value = alias.trim()
  if (!value) throw new Error('别名不能为空')
  if (/\s/.test(value)) throw new Error('别名不能含空格')
  const dup = cfg.modelByAlias(value)
  if (dup && dup.id !== exceptId) throw new Error(`别名 ${value} 已被占用`)
  return value
}

export function register(): void {
  handle(
    'createModel',
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

  handle(
    'updateModel',
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

  handle(
    'reorderModels',
    wrap((ids: string[]) => {
      cfg.mutate((c) => {
        const order = new Map(ids.map((id, i) => [id, i]))
        for (const m of c.models) m.sort = order.get(m.id) ?? m.sort + ids.length
      })
      return true
    })
  )

  handle(
    'deleteModel',
    wrap((id: string) => {
      cfg.mutate((c) => {
        c.models = c.models.filter((m) => m.id !== id)
      })
      return true
    })
  )

  handle(
    'lookupPrice',
    wrap((modelId: string, providerId?: string) => quote(modelId, providerId))
  )

  handle(
    'runProbe',
    wrap((id: string) => probe.run(id))
  )

  handle(
    'stopProbe',
    wrap((id?: string) => probe.stop(id))
  )
}
