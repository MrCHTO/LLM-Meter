import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const list = {
  data: [
    { id: 'deepseek/deepseek-v4.1-flash', pricing: { prompt: '0.0000003', completion: '0.0000012' } },
    {
      id: 'anthropic/claude-sonnet-4-5',
      pricing: {
        prompt: '0.000003',
        completion: '0.000015',
        input_cache_read: '0.0000003',
        input_cache_write: '0.00000375'
      }
    },
    { id: 'free/model', pricing: { prompt: '0', completion: '0' } }
  ]
}

async function load(): Promise<typeof import('../src/main/pricing')> {
  vi.resetModules()
  return import('../src/main/pricing')
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(list), { status: 200 }))
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('价格查询', () => {
  it('完整 id 直接命中并换算成每百万', async () => {
    const { lookup } = await load()
    const out = await lookup('anthropic/claude-sonnet-4-5')
    expect(out.found).toBe(true)
    expect(out.matchedId).toBe('anthropic/claude-sonnet-4-5')
    expect(out.priceIn).toBeCloseTo(3)
    expect(out.priceOut).toBeCloseTo(15)
    expect(out.priceCacheRead).toBeCloseTo(0.3)
    expect(out.priceCacheWrite).toBeCloseTo(3.75)
  })

  it('只有末段名也能命中', async () => {
    const { lookup } = await load()
    const out = await lookup('DeepSeek-V4.1-Flash')
    expect(out.found).toBe(true)
    expect(out.matchedId).toBe('deepseek/deepseek-v4.1-flash')
  })

  it('带日期后缀的变体靠前缀兜底，且不选 :batch', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              data: [
                { id: 'deepseek/deepseek-v4.1-flash-1017:batch', pricing: { prompt: '0.00000001', completion: '0.0000002' } },
                { id: 'deepseek/deepseek-v4.1-flash-1017', pricing: { prompt: '0.0000003', completion: '0.0000012' } }
              ]
            }),
            { status: 200 }
          )
      )
    )
    const { lookup } = await load()
    const out = await lookup('DeepSeek-V4.1-Flash')
    expect(out.found).toBe(true)
    expect(out.matchedId).toBe('deepseek/deepseek-v4.1-flash-1017')
  })

  it('忽略大小写与分隔符差异', async () => {
    const { lookup } = await load()
    const out = await lookup('claude_sonnet_4_5')
    expect(out.found).toBe(true)
  })

  it('查不到时给出提示且不编价格', async () => {
    const { lookup } = await load()
    const out = await lookup('no-such-model')
    expect(out.found).toBe(false)
    expect(out.priceIn).toBeUndefined()
    expect(out.note).toContain('请手填')
  })

  it('空 id 直接返回', async () => {
    const { lookup } = await load()
    expect((await lookup('  ')).found).toBe(false)
  })

  it('全零价格的模型不入列表', async () => {
    const { lookup } = await load()
    expect((await lookup('free/model')).found).toBe(false)
  })

  it('超时给出可读提示', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        const err = new Error('aborted')
        err.name = 'AbortError'
        throw err
      })
    )
    const { lookup } = await load()
    const out = await lookup('deepseek/deepseek-v4.1-flash')
    expect(out.found).toBe(false)
    expect(out.note).toContain('超时')
  })

  it('请求失败也能兜住', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 502 })))
    const { lookup } = await load()
    const out = await lookup('deepseek/deepseek-v4.1-flash')
    expect(out.found).toBe(false)
    expect(out.note).toContain('请手填')
  })
})
