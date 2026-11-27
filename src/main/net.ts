import { networkInterfaces } from 'node:os'

/** 取本机第一个非内部 IPv4，拿不到就回落到回环 */
export function lanIp(): string {
  const nets = networkInterfaces()
  for (const list of Object.values(nets)) {
    for (const net of list ?? []) {
      if (net.family !== 'IPv4' || net.internal) continue
      if (net.address.startsWith('169.254.')) continue
      return net.address
    }
  }
  return '127.0.0.1'
}
