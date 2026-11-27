import { safeStorage } from 'electron'

/**
 * API key 落盘前加密。Windows 下 safeStorage 走 DPAPI，绑定当前用户；
 * 极端情况下不可用则退化为 base64 明文，并在前缀上标明。
 */
export function seal(plain: string): string {
  if (!plain) return ''
  if (safeStorage.isEncryptionAvailable()) {
    return `enc:${safeStorage.encryptString(plain).toString('base64')}`
  }
  return `raw:${Buffer.from(plain, 'utf8').toString('base64')}`
}

export function open(cipher: string): string {
  if (!cipher) return ''
  if (cipher.startsWith('enc:')) {
    try {
      return safeStorage.decryptString(Buffer.from(cipher.slice(4), 'base64'))
    } catch {
      return ''
    }
  }
  if (cipher.startsWith('raw:')) {
    try {
      return Buffer.from(cipher.slice(4), 'base64').toString('utf8')
    } catch {
      return ''
    }
  }
  return ''
}

/** 只露头尾，用于界面回显。 */
export function mask(key: string): string {
  if (!key) return '（未设置）'
  if (key.length <= 10) return `${key.slice(0, 2)}••••`
  return `${key.slice(0, 6)}••••${key.slice(-4)}`
}
