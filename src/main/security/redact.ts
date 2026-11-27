/** 日志脱敏：鉴权类头只留头尾，避免 key 落进日志 */

const SECRET_HEADERS = new Set(['authorization', 'x-api-key', 'cookie', 'set-cookie', 'proxy-authorization'])

export function maskHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    out[key] = SECRET_HEADERS.has(key.toLowerCase()) ? `${value.slice(0, 6)}***${value.slice(-4)}` : value
  }
  return out
}
