import { describe, expect, it } from 'vitest'
import { adapterFor } from '../src/main/proxy/adapters'

describe('openai 适配器', () => {
  const a = adapterFor('openai')

  it('注入 include_usage 且换成上游模型名', () => {
    const out = a.prepare({ model: 'alias', stream: true, messages: [] }, 'gpt-real')
    const body = JSON.parse(out.body) as Record<string, unknown>
    expect(body.model).toBe('gpt-real')
    expect(body.stream).toBe(true)
    expect(body.stream_options).toEqual({ include_usage: true })
    expect(out.stream).toBe(true)
  })

  it('保留已有的 stream_options 字段', () => {
    const out = a.prepare({ model: 'a', stream: true, stream_options: { foo: 1 } }, 'b')
    expect(JSON.parse(out.body).stream_options).toEqual({ foo: 1, include_usage: true })
  })

  it('非流式不注入 stream_options', () => {
    const out = a.prepare({ model: 'a' }, 'b')
    expect(out.stream).toBe(false)
    expect(JSON.parse(out.body).stream_options).toBeUndefined()
  })

  it('从 usage 帧读缓存读取 token', () => {
    const info = a.onFrame(
      'data: {"usage":{"prompt_tokens":1200,"completion_tokens":460,"prompt_tokens_details":{"cached_tokens":1080}}}'
    )
    expect(info.usage).toEqual({ input: 1200, output: 460, cacheRead: 1080, cacheInput: 0 })
  })

  it('兼容 DeepSeek 的 prompt_cache_hit_tokens', () => {
    const info = a.onFrame('data: {"usage":{"prompt_tokens":900,"completion_tokens":10,"prompt_cache_hit_tokens":800}}')
    expect(info.usage?.cacheRead).toBe(800)
  })

  it('prompt_tokens_details 为 null 时视为未上报缓存读（GLM 渠道）', () => {
    const info = a.onFrame(
      'data: {"usage":{"prompt_tokens":13,"completion_tokens":5,"prompt_tokens_details":null,"completion_tokens_details":{"reasoning_tokens":5}}}'
    )
    expect(info.usage?.cacheRead).toBe(0)
    expect(info.reportedCacheRead).toBe(false)
  })

  it('details 带对象时视为已上报缓存读', () => {
    const info = a.onFrame(
      'data: {"usage":{"prompt_tokens":1200,"completion_tokens":460,"prompt_tokens_details":{"cached_tokens":1080}}}'
    )
    expect(info.reportedCacheRead).toBe(true)
  })

  it('统计增量字符并标记首内容', () => {
    const info = a.onFrame('data: {"choices":[{"delta":{"content":"你好"}}]}')
    expect(info.chars).toBe(2)
    expect(info.cjk).toBe(2)
    expect(info.other).toBe(0)
    expect(info.firstContent).toBe(true)
  })

  it('中英混合按语种分别计数', () => {
    const info = a.onFrame('data: {"choices":[{"delta":{"content":"你好, ok"}}]}')
    expect(info.cjk).toBe(2)
    expect(info.other).toBe(4)
  })

  it('数组形态的 content 也能取到文本', () => {
    const info = a.onFrame('data: {"choices":[{"delta":{"content":[{"text":"ab"}]}}]}')
    expect(info.chars).toBe(2)
  })

  it('推理通道的增量也计入内容与首字', () => {
    for (const key of ['reasoning', 'reasoning_content']) {
      const info = a.onFrame(`data: {"choices":[{"delta":{"${key}":"想一下"}}]}`)
      expect(info.chars).toBe(3)
      expect(info.firstContent).toBe(true)
    }
  })

  it('读出错误帧', () => {
    const info = a.onFrame('data: {"error":{"message":"rate limit"}}')
    expect(info.error).toBe('rate limit')
  })

  it('非流式响应体解析 usage', () => {
    const out = a.parseUsage('{"usage":{"prompt_tokens":10,"completion_tokens":20}}')
    expect(out?.usage).toEqual({ input: 10, output: 20, cacheRead: 0, cacheInput: 0 })
    expect(out?.reportedCacheInput).toBe(false)
  })

  it('带缓存写入字段时标记已上报', () => {
    const out = a.parseUsage(
      '{"usage":{"prompt_tokens":10,"completion_tokens":20,"prompt_tokens_details":{"cache_creation_tokens":5}}}'
    )
    expect(out?.reportedCacheInput).toBe(true)
    expect(out?.usage.cacheInput).toBe(5)
  })
})

describe('anthropic 适配器', () => {
  const a = adapterFor('anthropic')

  it('缺 max_tokens 时补默认值', () => {
    const body = JSON.parse(a.prepare({ model: 'x' }, 'claude-real').body) as Record<string, unknown>
    expect(body.max_tokens).toBe(4096)
    expect(body.model).toBe('claude-real')
  })

  it('message_start 的输入侧 usage 把缓存并入 input', () => {
    const info = a.onFrame(
      'data: {"type":"message_start","message":{"usage":{"input_tokens":120,"cache_read_input_tokens":1080,"cache_creation_input_tokens":0,"output_tokens":1}}}'
    )
    expect(info.usage).toEqual({ input: 1200, output: 1, cacheRead: 1080, cacheInput: 0 })
    expect(info.reportedCacheInput).toBe(true)
  })

  it('message_delta 覆盖输出 token', () => {
    const info = a.onFrame('data: {"type":"message_delta","usage":{"output_tokens":460}}')
    expect(info.usage).toEqual({ output: 460 })
  })

  it('text_delta 记为内容', () => {
    const info = a.onFrame('data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"好"}}')
    expect(info.chars).toBe(1)
    expect(info.firstContent).toBe(true)
  })

  it('error 事件带出信息', () => {
    const info = a.onFrame('data: {"type":"error","error":{"message":"overloaded"}}')
    expect(info.error).toBe('overloaded')
  })
})

describe('鉴权头', () => {
  it('openai 用 Bearer，anthropic 用 x-api-key', () => {
    expect(adapterFor('openai').auth('k')).toEqual({ authorization: 'Bearer k' })
    expect(adapterFor('anthropic').auth('k')).toEqual({ 'x-api-key': 'k' })
  })

  it('anthropic 默认带版本头', () => {
    expect(adapterFor('anthropic').baseHeaders()['anthropic-version']).toBe('2023-06-01')
  })
})
