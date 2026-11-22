import { safeStorage } from 'electron'

/** Cifra con el llavero del sistema cuando está disponible (macOS Keychain, DPAPI, libsecret). */
export function encrypt(plain: string): string {
  if (!safeStorage.isEncryptionAvailable()) return plain
  return 'enc:' + safeStorage.encryptString(plain).toString('base64')
}

export function decrypt(stored: string): string {
  if (!stored.startsWith('enc:')) return stored
  return safeStorage.decryptString(Buffer.from(stored.slice(4), 'base64'))
}
