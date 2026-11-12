import { randomBytes, timingSafeEqual } from 'node:crypto'

export function generate(): string {
  return randomBytes(16).toString('hex')
}

/** 定长比较，避免按字符提前返回泄露前缀。 */
export function equals(expected: string, got: string): boolean {
  if (!expected || !got) return false
  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(got, 'utf8')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/** 从 Authorization 或 x-api-key 里取候选 token。 */
export function fromHeaders(headers: Record<string, string | string[] | undefined>): string {
  const auth = headers.authorization
  const authStr = Array.isArray(auth) ? auth[0] : auth
  if (authStr) {
    const m = /^Bearer\s+(.+)$/i.exec(authStr.trim())
    if (m?.[1]) return m[1].trim()
    return authStr.trim()
  }
  const xKey = headers['x-api-key']
  const xKeyStr = Array.isArray(xKey) ? xKey[0] : xKey
  return (xKeyStr ?? '').trim()
}

export function masked(token: string): string {
  return token ? `${token.slice(0, 6)}••••••••${token.slice(-4)}` : ''
}
