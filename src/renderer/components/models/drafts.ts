import type { ApiFormat } from '../../../shared/types'

export interface ProviderDraft {
  id?: string
  name: string
  baseUrl: string
  format: ApiFormat
  apiKey: string
}

export interface ModelDraft {
  id?: string
  providerId: string
  upstreamModel: string
  alias: string
  priceIn: string
  priceOut: string
  priceCacheRead: string
  priceCacheInput: string
  cacheInputSupported: boolean | null
  currency: string
  watch: boolean
}

export const EMPTY_PROVIDER: ProviderDraft = { name: '', baseUrl: '', format: 'openai', apiKey: '' }

export function emptyModel(providerId: string): ModelDraft {
  return {
    providerId,
    upstreamModel: '',
    alias: '',
    priceIn: '0',
    priceOut: '0',
    priceCacheRead: '0',
    priceCacheInput: '0',
    cacheInputSupported: null,
    currency: 'CNY',
    watch: true
  }
}
