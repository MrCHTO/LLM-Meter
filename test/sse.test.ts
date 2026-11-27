import { describe, expect, it } from 'vitest'
import { SseTap, dataOf, parseJson } from '../src/main/proxy/sse'

describe('SseTap', () => {
  it('按 \\n\\n 切帧', () => {
    const tap = new SseTap()
    const frames = tap.feed(Buffer.from('data: a\n\ndata: b\n\n'))
    expect(frames).toEqual(['data: a', 'data: b'])
  })

  it('一帧被 TCP 切在两块里也要拼回来', () => {
    const tap = new SseTap()
    const first = tap.feed(Buffer.from('data: {"type":"content_block_del'))
    expect(first).toEqual([])
    const second = tap.feed(Buffer.from('ta","delta":{"text":"你好"}}\n\n'))
    expect(second).toEqual(['data: {"type":"content_block_delta","delta":{"text":"你好"}}'])
  })

  it('多字节字符被切在字节中间不乱码', () => {
    const tap = new SseTap()
    const payload = Buffer.from('data: 温度\n\n', 'utf8')
    const cut = 8
    expect(tap.feed(payload.subarray(0, cut))).toEqual([])
    const frames = tap.feed(payload.subarray(cut))
    expect(frames).toEqual(['data: 温度'])
  })

  it('保留末尾未完成的帧直到分隔符到达', () => {
    const tap = new SseTap()
    expect(tap.feed(Buffer.from('data: x\n'))).toEqual([])
    expect(tap.feed(Buffer.from('\n'))).toEqual(['data: x'])
  })

  it('CRLF 分隔符不会被当成两帧', () => {
    const tap = new SseTap()
    expect(tap.feed(Buffer.from('data: x\r\ndata: y\r\n\r\n'))).toEqual(['data: x\r\ndata: y'])
  })
})

describe('dataOf / parseJson', () => {
  it('取出全部 data 行', () => {
    expect(dataOf('event: message_delta\ndata: {"a":1}\ndata: {"b":2}')).toEqual(['{"a":1}', '{"b":2}'])
  })

  it('[DONE] 解析为 null', () => {
    expect(parseJson('[DONE]')).toBeNull()
    expect(parseJson('{"a":1}')).toEqual({ a: 1 })
    expect(parseJson('not json')).toBeNull()
  })
})
