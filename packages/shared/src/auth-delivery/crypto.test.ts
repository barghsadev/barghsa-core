import { afterEach, expect, it, vi } from 'vitest'
import { encryptAuthDelivery, decryptAuthDelivery } from './crypto.js'

afterEach(() => vi.unstubAllEnvs())

it('encrypts auth messages with random ciphertext bound to their row', () => {
  const message = { code: '123456', destination: 'mail@example.test' }
  const first = encryptAuthDelivery('row-a', message, 'test-key')
  expect(first).not.toContain(message.code)
  expect(first).not.toContain(message.destination)
  expect(encryptAuthDelivery('row-a', message, 'test-key')).not.toBe(first)
  expect(decryptAuthDelivery('row-a', first, 'test-key')).toEqual(message)
  expect(() => decryptAuthDelivery('row-b', first, 'test-key')).toThrow()
  expect(() => decryptAuthDelivery('row-a', first, 'wrong-key')).toThrow()
  const parts = first.split(':')
  const bytes = Buffer.from(parts[3]!, 'base64url')
  bytes[0] = bytes[0]! ^ 1
  parts[3] = bytes.toString('base64url')
  expect(() => decryptAuthDelivery('row-a', parts.join(':'), 'test-key')).toThrow()
})

it('fails closed when the encryption key is missing', () => {
  vi.stubEnv('AUTH_DELIVERY_ENCRYPTION_KEY', '')
  expect(() => encryptAuthDelivery('row', { code: '123456' })).toThrow('not configured')
})
