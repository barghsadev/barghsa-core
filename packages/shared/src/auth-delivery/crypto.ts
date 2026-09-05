import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

function key(raw: string | undefined): Buffer {
  if (!raw) throw new Error('Auth delivery encryption key is not configured')
  return /^[a-f0-9]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : createHash('sha256').update(raw).digest()
}

export function encryptAuthDelivery(id: string, value: unknown, secret = process.env.AUTH_DELIVERY_ENCRYPTION_KEY): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(secret), iv)
  cipher.setAAD(Buffer.from(id))
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()])
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')].join(':')
}

export function decryptAuthDelivery(id: string, value: string, secret = process.env.AUTH_DELIVERY_ENCRYPTION_KEY): unknown {
  const parts = value.split(':')
  if (parts.length !== 4 || parts[0] !== 'v1') throw new Error('Invalid auth delivery ciphertext')
  const decipher = createDecipheriv('aes-256-gcm', key(secret), Buffer.from(parts[1]!, 'base64url'))
  decipher.setAAD(Buffer.from(id))
  decipher.setAuthTag(Buffer.from(parts[2]!, 'base64url'))
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(parts[3]!, 'base64url')), decipher.final()]).toString('utf8'))
}

/** Compatibility with the provider configuration service's stored v1 values. */
export function decryptProviderSecret(value: string): string {
  if (!value.startsWith('v1:')) return value
  const parts = value.split(':')
  if (parts.length !== 4) throw new Error('Invalid provider ciphertext')
  const decipher = createDecipheriv('aes-256-gcm', key(process.env.PROVIDER_CONFIG_ENCRYPTION_KEY), Buffer.from(parts[1]!, 'base64url'))
  decipher.setAuthTag(Buffer.from(parts[2]!, 'base64url'))
  return Buffer.concat([decipher.update(Buffer.from(parts[3]!, 'base64url')), decipher.final()]).toString('utf8')
}
