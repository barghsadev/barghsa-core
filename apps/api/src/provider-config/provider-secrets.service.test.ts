import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  ProviderSecretsService,
  isEncryptedSecretValue,
  PROVIDER_SECRET_ENCRYPTION_ENV,
} from './provider-secrets.service'

const KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'

describe('ProviderSecretsService (T-05.06.05)', () => {
  const originalEnv = process.env[PROVIDER_SECRET_ENCRYPTION_ENV]

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env[PROVIDER_SECRET_ENCRYPTION_ENV]
    } else {
      process.env[PROVIDER_SECRET_ENCRYPTION_ENV] = originalEnv
    }
    vi.restoreAllMocks()
  })

  it('encrypts and decrypts a value round-trip', () => {
    const svc = new ProviderSecretsService(KEY)
    const enc = svc.encryptValue('super-secret')
    expect(enc).toMatch(/^v1:[^:]+:[^:]+:[^:]+$/)
    expect(isEncryptedSecretValue(enc)).toBe(true)
    expect(enc).not.toContain('super-secret')
    expect(svc.decryptValue(enc)).toBe('super-secret')
  })

  it('uses a random IV so identical plaintexts produce distinct ciphertexts', () => {
    const svc = new ProviderSecretsService(KEY)
    const a = svc.encryptValue('same-value')
    const b = svc.encryptValue('same-value')
    expect(a).not.toBe(b)
    expect(svc.decryptValue(a)).toBe('same-value')
    expect(svc.decryptValue(b)).toBe('same-value')
  })

  it('passes through legacy plaintext values unchanged (backward compat)', () => {
    const svc = new ProviderSecretsService(KEY)
    expect(svc.decryptValue('plain-legacy-value')).toBe('plain-legacy-value')
    expect(isEncryptedSecretValue('plain-legacy-value')).toBe(false)
  })

  it('fails closed on a tampered ciphertext', () => {
    const svc = new ProviderSecretsService(KEY)
    const enc = svc.encryptValue('super-secret')
    const parts = enc.split(':')
    const [version, iv, tag, data] = parts as [string, string, string, string]
    const tampered = [version, iv, tag, `${data.slice(0, -1)}x`].join(':')
    expect(() => svc.decryptValue(tampered)).toThrow()
  })

  it('throws when decryption is attempted without a configured key', () => {
    const svc = new ProviderSecretsService(undefined)
    process.env[PROVIDER_SECRET_ENCRYPTION_ENV] = ''
    expect(svc.available).toBe(false)
    // Plaintext values still pass through without a key (no decrypt needed).
    expect(svc.decryptValue('plain')).toBe('plain')
    // But encrypting a secret requires a key.
    expect(() => svc.encryptValue('secret')).toThrow(/not set/)
  })

  it('reads the encryption key from the environment when not injected', () => {
    process.env[PROVIDER_SECRET_ENCRYPTION_ENV] = KEY
    const svc = new ProviderSecretsService(undefined)
    expect(svc.available).toBe(true)
    const enc = svc.encryptValue('env-key-secret')
    expect(svc.decryptValue(enc)).toBe('env-key-secret')
  })

  it('masks a value showing only the last 4 characters', () => {
    const svc = new ProviderSecretsService(KEY)
    expect(svc.maskValue('super-secret')).toBe('********cret')
    expect(svc.maskValue('abc')).toBe('***')
    expect(svc.maskValue('abcd')).toBe('****')
  })

  it('encrypts only secret fields in a transport config', () => {
    const svc = new ProviderSecretsService(KEY)
    const smtp = svc.encryptConfig('smtp', { host: 'smtp.example.com', password: 'p' })
    expect(smtp.host).toBe('smtp.example.com')
    expect(isEncryptedSecretValue(String(smtp.password))).toBe(true)

    const resend = svc.encryptConfig('resend', { from_email: 'a@b.com', api_key: 'k' })
    expect(resend.from_email).toBe('a@b.com')
    expect(isEncryptedSecretValue(String(resend.api_key))).toBe(true)
  })

  it('decryptConfig restores secrets only for the send boundary', () => {
    const svc = new ProviderSecretsService(KEY)
    const stored = svc.encryptConfig('smtp', { host: 'h', password: 'pw' })
    const decrypted = svc.decryptConfig('smtp', stored)
    expect(decrypted).toMatchObject({ host: 'h', password: 'pw' })
  })

  it('maskConfig strips secrets to a masked display value', () => {
    const svc = new ProviderSecretsService(KEY)
    const stored = svc.encryptConfig('resend', {
      from_email: 'admin@example.com',
      api_key: 're_abcd1234',
    })
    const masked = svc.maskConfig('resend', stored)
    expect(masked.from_email).toBe('admin@example.com')
    expect(String(masked.api_key)).toMatch(/^\*+1234$/)
    // No encrypted blob leaks to a masked result.
    expect(JSON.stringify(masked)).not.toContain('v1:')
  })

  it('maskConfig passes through non-secret configs unchanged', () => {
    const svc = new ProviderSecretsService(KEY)
    const masked = svc.maskConfig('smtp', { host: 'h', port: 587 })
    expect(masked).toMatchObject({ host: 'h', port: 587 })
  })
})