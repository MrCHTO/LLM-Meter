import { describe, expect, it } from 'vitest'
import { issue, masked, verifyToken } from '../src/main/security/token'

describe('本地 token（Ed25519）', () => {
  it('签发的是 sk- 票据且能通过验签', () => {
    const { key, token } = issue()
    expect(token).toMatch(/^sk-[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
    expect(verifyToken(key, '', token)).toBe(true)
  })

  it('篡改签名不通过', () => {
    const { key, token } = issue()
    const tampered = `${token.slice(0, -2)}${token.endsWith('aa') ? 'bb' : 'aa'}`
    expect(verifyToken(key, '', tampered)).toBe(false)
  })

  it('kid 不匹配不通过', () => {
    const { token } = issue()
    const other = issue()
    expect(verifyToken(other.key, '', token)).toBe(false)
  })

  it('没有密钥对时退回明文比较', () => {
    expect(verifyToken(null, 'plain-token', 'plain-token')).toBe(true)
    expect(verifyToken(null, 'plain-token', 'other')).toBe(false)
  })

  it('遮罩保留 sk- 前缀与尾 4 位', () => {
    const out = masked('sk-abcdefghijkl1234')
    expect(out.startsWith('sk-')).toBe(true)
    expect(out.endsWith('1234')).toBe(true)
    expect(out).not.toContain('defgh')
  })
})
