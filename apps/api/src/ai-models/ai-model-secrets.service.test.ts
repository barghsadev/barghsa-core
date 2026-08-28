import { describe, it, expect, beforeEach } from 'vitest'
import {
  AiModelSecretsService,
  isMaskedAiToken,
  isEncryptedAiToken,
} from './ai-model-secrets.service.js'

const TEST_KEY = Buffer.from('0123456789abcdef0123456789abcdef') // 32 raw bytes

describe('AiModelSecretsService (T-09.11.01)', () => {
  let service: AiModelSecretsService

  beforeEach(() => {
    service = new AiModelSecretsService(TEST_KEY)
  })

  it('encrypts and decrypts a token round-trip', () => {
    const stored = service.encryptToken('sk-super-secret-token-1234')
    expect(stored).not.toContain('super-secret')
    expect(stored.startsWith('v1:')).toBe(true)
    expect(service.decryptToken(stored)).toBe('sk-super-secret-token-1234')
  })

  it('uses a fresh IV per encryption (no two blobs are identical)', () => {
    const a = service.encryptToken('same-token')
    const b = service.encryptToken('same-token')
    expect(a).not.toBe(b)
  })

  it('fails closed on a tampered ciphertext', () => {
    const stored = service.encryptToken('sk-tamper-me')
    // Flip a character in the data segment — index 0 of the payload after
    // `v1:<iv>:<tag>:`; guaranteed to change the decoded bytes.
    const parts = stored.split(':')
    const corrupted = [...parts]
    corrupted[3] = (parts[3]![0] === 'a' ? 'b' : 'a') + parts[3]!.slice(1)
    expect(() => service.decryptToken(corrupted.join(':'))).toThrow()
  })

  it('fails closed on a malformed blob', () => {
    expect(() => service.decryptToken('v1:onlytwo')).toThrow()
  })

  it('passes legacy plaintext through on decrypt (backward compatible)', () => {
    expect(service.decryptToken('plain-token')).toBe('plain-token')
  })

  it('masks tokens revealing only the last 4 characters', () => {
    expect(service.maskToken(service.encryptToken('sk-abcdefgh1234'))).toBe('***********1234')
  })

  it('fully masks short tokens', () => {
    expect(service.maskToken(service.encryptToken('ab'))).toBe('**')
  })

  it('maskToken never throws on an undecryptable blob', () => {
    expect(service.maskToken('v1:zz:zz:zz')).toBe('[encrypted]')
    // Legacy plaintext passes through and is masked as-is.
    expect(service.maskToken('legacy-plain')).toBe('********lain')
  })

  it('encryptToken fails closed when no key is configured', () => {
    const keyless = new AiModelSecretsService()
    expect(keyless.available).toBe(false)
    expect(() => keyless.encryptToken('sk-any')).toThrow(/AI_MODEL_ENCRYPTION_KEY/)
  })

  it('decryptToken fails closed when no key is configured', () => {
    const keyless = new AiModelSecretsService()
    expect(() => keyless.decryptToken('v1:aa:bb:cc')).toThrow(/AI_MODEL_ENCRYPTION_KEY/)
  })

  it('resolves a 64-hex-char string key as 32 raw bytes', () => {
    const hexKey = new AiModelSecretsService('a'.repeat(64))
    const stored = hexKey.encryptToken('token')
    expect(hexKey.decryptToken(stored)).toBe('token')
  })

  it('derives a 32-byte key from a non-hex string via SHA-256', () => {
    const derived = new AiModelSecretsService('not-hex-just-a-passphrase-123')
    const stored = derived.encryptToken('token')
    expect(derived.decryptToken(stored)).toBe('token')
  })
})

describe('isEncryptedAiToken / isMaskedAiToken', () => {
  it('detects v1: encrypted blobs', () => {
    expect(isEncryptedAiToken('v1:aa:bb:cc')).toBe(true)
    expect(isEncryptedAiToken('plain')).toBe(false)
    expect(isEncryptedAiToken(42)).toBe(false)
  })

  it('detects masked placeholder values (echoed from the admin UI)', () => {
    expect(isMaskedAiToken('********1234')).toBe(true)
    expect(isMaskedAiToken('*')).toBe(true)
    expect(isMaskedAiToken('sk-real-token')).toBe(false)
    expect(isMaskedAiToken('')).toBe(false)
  })
})
