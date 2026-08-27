import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  ResendConnectionTesterService,
  type ResendApiClientLike,
} from './resend-connection-tester.service'
import type { ResendConfig } from './resend-config.schema'

describe('ResendConnectionTesterService (T-05.06.03)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  const baseConfig: ResendConfig = {
    api_key: 're_secret-key-123',
    from_name: 'Barghsa',
    from_email: 'no-reply@example.com',
  }

  const fakeClient = (
    overrides: Partial<ResendApiClientLike>,
  ): ResendApiClientLike => ({
    listDomains: async () => [
      { id: 'd1', name: 'example.com', status: 'verified' },
    ],
    sendEmail: async () => ({ id: 'email_123' }),
    ...overrides,
  })

  it('returns ok when the domain is verified and the test-send succeeds', async () => {
    const sendEmail: ResendApiClientLike['sendEmail'] = vi.fn(async () => ({ id: 'email_1' }))
    const client = fakeClient({ sendEmail })
    const service = new ResendConnectionTesterService(client)
    const result = await service.test(baseConfig, 'admin@example.com')
    expect(result.ok).toBe(true)
    expect(sendEmail).toHaveBeenCalledOnce()
    const payload = vi.mocked(sendEmail).mock.calls[0]![1]
    expect(payload.to).toBe('admin@example.com')
    expect(payload.from).toContain('Barghsa')
    expect(payload.from).toContain('no-reply@example.com')
  })

  it('uses from_email domain when sending_domain is absent', async () => {
    const listDomains = vi.fn(async () => [
      { id: 'd1', name: 'example.com', status: 'verified' },
    ])
    const service = new ResendConnectionTesterService(fakeClient({ listDomains }))
    await service.test(baseConfig, 'admin@example.com')
    // only called once (no extra sends), the domain derives from from_email.
    expect(listDomains).toHaveBeenCalledOnce()
  })

  it('fails when the sending domain is not registered in the account', async () => {
    const client = fakeClient({ listDomains: async () => [] })
    const service = new ResendConnectionTesterService(client)
    const result = await service.test(baseConfig, 'admin@example.com')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('not registered')
  })

  it('fails when the sending domain is not yet verified', async () => {
    const client = fakeClient({
      listDomains: async () => [
        { id: 'd1', name: 'example.com', status: 'pending' },
      ],
    })
    const service = new ResendConnectionTesterService(client)
    const result = await service.test(baseConfig, 'admin@example.com')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('not verified')
  })

  it('falls back to sending_domain when explicitly configured', async () => {
    const listDomains = vi.fn(async () => [
      { id: 'd1', name: 'marketing.example.com', status: 'verified' },
    ])
    const service = new ResendConnectionTesterService(fakeClient({ listDomains }))
    const result = await service.test(
      { ...baseConfig, from_email: 'no-reply@other.com', sending_domain: 'marketing.example.com' },
      'admin@example.com',
    )
    expect(result.ok).toBe(true)
    // listDomains was called; the marketing domain had to be looked up.
    expect(listDomains).toHaveBeenCalledOnce()
  })

  it('fails when the test-send is rejected by Resend', async () => {
    const client = fakeClient({ sendEmail: async () => ({ message: 'domain not verified' }) })
    const service = new ResendConnectionTesterService(client)
    const result = await service.test(baseConfig, 'admin@example.com')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('domain not verified')
  })

  it('redacts the api_key from error messages', async () => {
    const secret = 'secret-test-key-123'
    const client = fakeClient({
      sendEmail: async () => ({ message: `unauthorized for key ${secret}` }),
    })
    const service = new ResendConnectionTesterService(client)
    const result = await service.test(
      { ...baseConfig, api_key: secret },
      'admin@example.com',
    )
    expect(result.ok).toBe(false)
    expect(result.error).not.toContain(secret)
    expect(result.error).toContain('••••')
  })

  it('handles a thrown error from the API client', async () => {
    const client = fakeClient({
      listDomains: async () => {
        throw new Error('HTTP 401 unauthorized')
      },
    })
    const service = new ResendConnectionTesterService(client)
    const result = await service.test(baseConfig, 'admin@example.com')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('Could not verify sending domain')
  })
})