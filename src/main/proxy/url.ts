/**
 * 拼接上游地址。Base URL 有的写到域名、有的已经写到 /v1，
 * 所以当两边都以 /v1 结尾/开头时只保留一份。
 */
export function joinUrl(base: string, rest: string, search = ''): URL {
  const trimmedBase = base.trim().replace(/\/+$/, '')
  const path = rest.startsWith('/') ? rest : `/${rest}`
  const deduped = /\/v1$/i.test(trimmedBase) && /^\/v1(\/|$)/i.test(path) ? trimmedBase.slice(0, -3) : trimmedBase
  return new URL(`${deduped}${path}${search}`)
}
