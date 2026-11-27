import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  timingSafeEqual,
  verify
} from 'node:crypto'

/** 本地 API Key：`sk-` + 32 位十六进制随机串；旧版 `sk-<payload>.<sig>` 仍可验签 */
export interface LocalKey {
  kid: string
  /** PKCS8 DER，base64 */
  privateKey: string
}

const PREFIX = 'sk-'

function privateKeyOf(key: LocalKey) {
  return createPrivateKey({ key: Buffer.from(key.privateKey, 'base64'), format: 'der', type: 'pkcs8' })
}

/** 生成密钥对（仅旧签名票据校验时用到） */
export function newKey(): LocalKey {
  const { privateKey } = generateKeyPairSync('ed25519')
  return {
    kid: randomBytes(6).toString('hex'),
    privateKey: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64')
  }
}

/** 签发新 token：sk- + 32 位十六进制 */
export function issue(): { key: LocalKey | null; token: string } {
  return { key: null, token: `${PREFIX}${randomBytes(16).toString('hex')}` }
}

function constantEquals(expected: string, got: string): boolean {
  if (!expected || !got) return false
  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(got, 'utf8')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/** 在多条命名 token 里找命中的那条；返回备注供统计分组 */
export function matchToken(
  tokens: { id: string; remark: string; token: string }[],
  got: string
): { id: string; remark: string } | null {
  let hit: { id: string; remark: string } | null = null
  for (const t of tokens) {
    if (constantEquals(t.token, got) && !hit) hit = { id: t.id, remark: t.remark }
  }
  return hit
}

/**
 * 校验：带 `.` 的是旧版签名票据，验签；否则按明文常量比较。
 */
export function verifyToken(key: LocalKey | null, expectedPlain: string, got: string): boolean {
  if (!got) return false
  if (!got.startsWith(PREFIX)) return false
  const body = got.slice(PREFIX.length)
  if (!body.includes('.')) return constantEquals(expectedPlain, got)
  if (!key) return constantEquals(expectedPlain, got)
  const dot = body.lastIndexOf('.')
  if (dot <= 0 || dot === body.length - 1) return false
  const encoded = body.slice(0, dot)
  try {
    const payload = Buffer.from(encoded, 'base64url')
    const data = JSON.parse(payload.toString('utf8')) as { kid?: string }
    if (data.kid !== key.kid) return false
    const pub = createPublicKey(privateKeyOf(key))
    return verify(null, payload, pub, Buffer.from(body.slice(dot + 1), 'base64url'))
  } catch {
    return false
  }
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

/** 遮罩：保留 sk- 前缀与尾 4 位 */
export function masked(token: string): string {
  if (!token) return ''
  if (token.startsWith(PREFIX)) return `${PREFIX}••••••••${token.slice(-4)}`
  return `${token.slice(0, 6)}••••••••${token.slice(-4)}`
}

/** 配置里的密钥对形状校验 */
export function parseKey(raw: unknown): LocalKey | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (typeof o.kid !== 'string' || typeof o.privateKey !== 'string' || !o.kid || !o.privateKey) return null
  return { kid: o.kid, privateKey: o.privateKey }
}
