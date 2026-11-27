import { describe, expect, it } from 'vitest'
import { joinUrl } from '../src/main/proxy/url'

describe('joinUrl', () => {
  it('普通域名直接拼', () => {
    expect(joinUrl('https://relay.test', '/v1/messages').toString()).toBe('https://relay.test/v1/messages')
  })

  it('Base URL 已带 /v1 时不重复', () => {
    expect(joinUrl('https://relay.test/v1', '/v1/chat/completions').toString()).toBe(
      'https://relay.test/v1/chat/completions'
    )
  })

  it('末尾斜杠被清掉', () => {
    expect(joinUrl('https://relay.test/v1///', '/v1/messages').toString()).toBe('https://relay.test/v1/messages')
  })

  it('带端口与查询串', () => {
    expect(joinUrl('http://10.0.0.1:3001/v1', '/v1/chat/completions', '?x=1').toString()).toBe(
      'http://10.0.0.1:3001/v1/chat/completions?x=1'
    )
  })

  it('路径本身不是 /v1 开头时不动 Base', () => {
    expect(joinUrl('https://relay.test/v1', '/models').toString()).toBe('https://relay.test/v1/models')
  })
})
