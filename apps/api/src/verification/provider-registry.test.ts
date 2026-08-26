import { describe, it, expect, beforeEach } from 'vitest'
import { VerificationProviderRegistry } from './provider-registry.js'
import { StubVerificationProvider } from './providers/stub.provider.js'

describe('VerificationProviderRegistry', () => {
  let registry: VerificationProviderRegistry

  beforeEach(() => {
    registry = new VerificationProviderRegistry()
  })

  describe('register / unregister', () => {
    it('starts empty', () => {
      expect(registry.listProviders()).toHaveLength(0)
    })

    it('registers a provider', () => {
      registry.register(new StubVerificationProvider())
      expect(registry.listProviders()).toHaveLength(1)
      expect(registry.listProviders()[0]!.providerId).toBe('stub')
    })

    it('throws when registering a duplicate', () => {
      registry.register(new StubVerificationProvider())
      expect(() => registry.register(new StubVerificationProvider())).toThrow(
        'Provider "stub" is already registered',
      )
    })

    it('unregisters a provider', () => {
      registry.register(new StubVerificationProvider())
      expect(registry.unregister('stub')).toBe(true)
      expect(registry.listProviders()).toHaveLength(0)
    })

    it('returns false when unregistering unknown provider', () => {
      expect(registry.unregister('nonexistent')).toBe(false)
    })
  })

  describe('getAdapter', () => {
    it('returns the adapter when registered', () => {
      registry.register(new StubVerificationProvider())
      const adapter = registry.getAdapter('stub')
      expect(adapter).toBeDefined()
      expect(adapter!.providerId).toBe('stub')
    })

    it('returns undefined for unknown provider', () => {
      expect(registry.getAdapter('nonexistent')).toBeUndefined()
    })
  })

  describe('verify', () => {
    beforeEach(() => {
      registry.register(new StubVerificationProvider())
    })

    it('returns error for unknown provider', async () => {
      const result = await registry.verify('nonexistent', { nationalId: '1234567890' })
      expect(result.verified).toBe(false)
      expect(result.code).toBe('PROVIDER_ERROR')
    })

    it('returns error when provider is disabled', async () => {
      const result = await registry.verify('stub', { nationalId: '1234567890' }, {
        providerId: 'stub',
        settings: {},
        enabled: false,
      })
      expect(result.verified).toBe(false)
      expect(result.code).toBe('PROVIDER_ERROR')
    })

    it('validates input and returns error for missing nationalId', async () => {
      const result = await registry.verify('stub', {})
      expect(result.verified).toBe(false)
      expect(result.code).toBe('INVALID_INPUT')
    })

    it('validates nationalId format', async () => {
      const result = await registry.verify('stub', { nationalId: 'abc' })
      expect(result.verified).toBe(false)
      expect(result.code).toBe('INVALID_INPUT')
    })

    it('returns verified for valid nationalId', async () => {
      const result = await registry.verify('stub', { nationalId: '1234567890' })
      expect(result.verified).toBe(true)
      expect(result.code).toBe('VERIFIED')
    })

    it('returns verified for nationalId ending with 0000000000', async () => {
      const result = await registry.verify('stub', { nationalId: '0000000000' })
      expect(result.verified).toBe(true)
      expect(result.code).toBe('VERIFIED')
    })

    it('returns not found for nationalId ending with 9999999999', async () => {
      const result = await registry.verify('stub', { nationalId: '9999999999' })
      expect(result.verified).toBe(false)
      expect(result.code).toBe('NOT_FOUND')
    })
  })
})