import { describe, expect, it } from 'vitest'
import { createPrivateKey, createPublicKey, sign } from 'node:crypto'
import { issue, masked, newKey, verifyToken } from '../src/main/security/token'

describe('本地 token', () => {
  it('签发的是 sk- 加 32 位十六进制', () => {
    const { token, key } = issue()
    expect(token).toMatch(/^sk-[0-9a-f]{32}$/)
    expect(key).toBeNull()
  })

  it('明文 token 按常量比较', () => {
    const { token } = issue()
    expect(verifyToken(null, token, token)).toBe(true)
    expect(verifyToken(null, token, 'sk-other')).toBe(false)
    expect(verifyToken(null, token, token.slice(0, -2))).toBe(false)
  })

  it('旧版签名票据仍能验签', () => {
    const key = newKey()
    const payload = Buffer.from(JSON.stringify({ v: 1, kid: key.kid, iat: Date.now() }))
    const sig = sign(
      null,
      payload,
      createPrivateKey({ key: Buffer.from(key.privateKey, 'base64'), format: 'der', type: 'pkcs8' })
    )
    const token = `sk-${payload.toString('base64url')}.${sig.toString('base64url')}`
    expect(verifyToken(key, '', token)).toBe(true)
    // kid 不匹配
    expect(verifyToken(newKey(), '', token)).toBe(false)
    // 篡改签名
    expect(verifyToken(key, '', `${token.slice(0, -2)}xx`)).toBe(false)
    // 有密钥但传明文，退回常量比较
    expect(verifyToken(key, token, token)).toBe(true)
  })

  it('遮罩保留 sk- 前缀与尾 4 位', () => {
    const out = masked('sk-0123456789abcdef0123456789abcdef')
    expect(out.startsWith('sk-')).toBe(true)
    expect(out.endsWith('cdef')).toBe(true)
    expect(out).not.toContain('23456789')
  })

  it('公钥可从私钥推导', () => {
    const key = newKey()
    expect(
      createPublicKey(createPrivateKey({ key: Buffer.from(key.privateKey, 'base64'), format: 'der', type: 'pkcs8' }))
        .asymmetricKeyType
    ).toBe('ed25519')
  })
})
