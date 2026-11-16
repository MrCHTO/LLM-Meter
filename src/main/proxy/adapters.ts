import type { ApiFormat } from '../../shared/types'
import type { Usage } from '../metrics/cost'
import { asRecord, dataOf, num, parseJson } from './sse'

/** 流式帧的解析结果 */
export interface FrameInfo {
  /** 本帧新增的可计量字符数（无 usage 时用来估 token） */
  chars: number
  /** 本帧增量里的中文码点数（含全角标点），供实时速率按语种估算 */
  cjk: number
  /** 本帧增量里的其余码点数 */
  other: number
  /** 本帧是否出现首个有效内容（决定 TTFT） */
  firstContent: boolean
  /** 本帧携带的 usage 增量 */
  usage: Partial<Usage> | null
  /** 上游在流里报的错 */
  error: string | null
  /** 本帧 usage 是否带缓存输入字段 */
  reportedCacheInput: boolean
  /** 本帧 usage 是否带缓存读计数（prompt_tokens_details 有对象） */
  reportedCacheRead: boolean
}

export interface Prepared {
  body: string
  stream: boolean
}

export interface Adapter {
  format: ApiFormat
  /** 上游鉴权头 */
  auth(key: string): Record<string, string>
  /** 固定附加头 */
  baseHeaders(): Record<string, string>
  /** 改写请求体：改模型名、按需注入 usage、决定流式 */
  prepare(raw: Record<string, unknown>, upstreamModel: string): Prepared
  onFrame(frame: string): FrameInfo
  /** 非流式响应体里的 usage */
  parseUsage(body: string): { usage: Partial<Usage>; reportedCacheInput: boolean; reportedCacheRead: boolean } | null
  /** 从错误响应里取可读信息 */
  errorOf(body: string): string | null
}

const EMPTY_FRAME: FrameInfo = { chars: 0, cjk: 0, other: 0, firstContent: false, usage: null, error: null, reportedCacheInput: false, reportedCacheRead: false }

const CJK_CHAR = /[\u3000-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/

/** 按语种拆增量，用于实时速率估算；总数仍写 chars 供无 usage 兜底 */
function countText(info: FrameInfo, text: string): void {
  info.chars += text.length
  for (const ch of text) {
    if (CJK_CHAR.test(ch)) info.cjk += 1
    else info.other += 1
  }
}

function errorMessage(parsed: Record<string, unknown> | null): string | null {
  if (!parsed) return null
  const err = asRecord(parsed.error)
  if (err) {
    const m = err.message
    if (typeof m === 'string' && m) return m
  }
  const m = parsed.message
  return typeof m === 'string' && m ? m : null
}

const TEXT_KEYS = ['content', 'reasoning', 'reasoning_content', 'reasoning_text', 'text']

/** 取增量文本。推理模型的正文可能整段走在 reasoning 通道里，必须算进去。 */
function textOf(delta: Record<string, unknown> | null): string {
  if (!delta) return ''
  let out = ''
  for (const key of TEXT_KEYS) {
    const value = delta[key]
    if (typeof value === 'string') {
      out += value
      continue
    }
    if (!Array.isArray(value)) continue
    for (const part of value) {
      const item = asRecord(part)
      const text = item?.text
      if (typeof text === 'string') out += text
    }
  }
  return out
}

/* ------------------------------------------------------------------ OpenAI */

const openai: Adapter = {
  format: 'openai',
  auth: (key) => ({ authorization: `Bearer ${key}` }),
  baseHeaders: () => ({ 'content-type': 'application/json' }),

  prepare(raw, upstreamModel) {
    const body: Record<string, unknown> = { ...raw, model: upstreamModel }
    const stream = body.stream === true
    if (stream) {
      // 不开这个，流式响应里就没有 usage，token 与缓存全成瞎子
      const opts = asRecord(body.stream_options) ?? {}
      body.stream_options = { ...opts, include_usage: true }
    }
    return { body: JSON.stringify(body), stream }
  },

  onFrame(frame) {
    const info: FrameInfo = { ...EMPTY_FRAME }
    for (const payload of dataOf(frame)) {
      const parsed = parseJson(payload)
      if (!parsed) continue

      const err = errorMessage(parsed)
      if (err) {
        info.error = err
        continue
      }

      const usage = asRecord(parsed.usage)
      if (usage) {
        const details = asRecord(usage.prompt_tokens_details)
        const cached = num(details?.cached_tokens) || num(usage.prompt_cache_hit_tokens)
        const reported =
          'cache_write_tokens' in usage ||
          'cache_creation_tokens' in (details ?? {}) ||
          'cache_write_tokens' in (details ?? {})
        const written =
          num(usage.cache_write_tokens) ||
          num(details?.cache_creation_tokens) ||
          num(details?.cache_write_tokens)
        info.reportedCacheInput = reported
        // 渠道把 details 置空（GLM 渠道恒 null）时视为未上报缓存读，界面显示 — 而不是误导性的 0.00%
        info.reportedCacheRead = details !== null || num(usage.prompt_cache_hit_tokens) > 0
        info.usage = {
          input: num(usage.prompt_tokens),
          output: num(usage.completion_tokens),
          cacheRead: cached,
          cacheInput: written
        }
      }

      const choices = parsed.choices
      if (Array.isArray(choices)) {
        for (const choice of choices) {
          const text = textOf(asRecord(asRecord(choice)?.delta))
          if (text) {
            countText(info, text)
            info.firstContent = true
          }
        }
      }
    }
    return info
  },

  parseUsage(body) {
    const parsed = parseJson(body)
    const usage = asRecord(parsed?.usage)
    if (!usage) return null
    const details = asRecord(usage.prompt_tokens_details)
    return {
      reportedCacheInput:
        'cache_write_tokens' in usage ||
        'cache_creation_tokens' in (details ?? {}) ||
        'cache_write_tokens' in (details ?? {}),
      reportedCacheRead: details !== null || num(usage.prompt_cache_hit_tokens) > 0,
      usage: {
        input: num(usage.prompt_tokens),
        output: num(usage.completion_tokens),
        cacheRead: num(details?.cached_tokens) || num(usage.prompt_cache_hit_tokens),
        cacheInput: num(usage.cache_write_tokens) || num(details?.cache_creation_tokens) || num(details?.cache_write_tokens)
      }
    }
  },

  errorOf(body) {
    return errorMessage(parseJson(body))
  }
}

/* --------------------------------------------------------------- Anthropic */

const anthropic: Adapter = {
  format: 'anthropic',
  auth: (key) => ({ 'x-api-key': key }),
  baseHeaders: () => ({ 'content-type': 'application/json', 'anthropic-version': '2023-06-01' }),

  prepare(raw, upstreamModel) {
    const body: Record<string, unknown> = { ...raw, model: upstreamModel }
    // Anthropic 用 max_tokens 必填，客户端没给就补一个
    if (typeof body.max_tokens !== 'number') body.max_tokens = 4096
    return { body: JSON.stringify(body), stream: body.stream === true }
  },

  onFrame(frame) {
    const info: FrameInfo = { ...EMPTY_FRAME }
    for (const payload of dataOf(frame)) {
      const parsed = parseJson(payload)
      if (!parsed) continue

      const type = parsed.type
      if (type === 'error') {
        info.error = errorMessage(parsed) ?? '上游返回 error 事件'
        continue
      }

      // message_start 带输入侧 usage（含缓存读取/写）
      const message = asRecord(parsed.message)
      const startUsage = asRecord(message?.usage) ?? asRecord(parsed.usage)
      if (startUsage) {
        const read = num(startUsage.cache_read_input_tokens)
        const write = num(startUsage.cache_creation_input_tokens)
        info.reportedCacheInput = 'cache_creation_input_tokens' in startUsage
        info.reportedCacheRead = 'cache_read_input_tokens' in startUsage
        info.usage = {
          // Anthropic 的 input_tokens 不含缓存部分，统一补成总量
          input: num(startUsage.input_tokens) + read + write,
          output: num(startUsage.output_tokens),
          cacheRead: read,
          cacheInput: write
        }
      }

      // message_delta 带输出侧 usage（只给 output，其余沿用 message_start）
      if (type === 'message_delta') {
        const u = asRecord(parsed.usage)
        if (u) info.usage = { output: num(u.output_tokens) }
      }

      const delta = asRecord(parsed.delta)
      const text = textOf(delta)
      if (text) {
        countText(info, text)
        info.firstContent = true
      }
    }
    return info
  },

  parseUsage(body) {
    const parsed = parseJson(body)
    const usage = asRecord(asRecord(parsed?.message)?.usage) ?? asRecord(parsed?.usage)
    if (!usage) return null
    const read = num(usage.cache_read_input_tokens)
    const write = num(usage.cache_creation_input_tokens)
    return {
      reportedCacheInput: 'cache_creation_input_tokens' in usage,
      reportedCacheRead: 'cache_read_input_tokens' in usage,
      usage: {
        input: num(usage.input_tokens) + read + write,
        output: num(usage.output_tokens),
        cacheRead: read,
        cacheInput: write
      }
    }
  },

  errorOf(body) {
    return errorMessage(parseJson(body))
  }
}

export const adapters: Record<ApiFormat, Adapter> = { openai, anthropic }

export function adapterFor(format: ApiFormat): Adapter {
  return adapters[format]
}
