import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  SmsirConnectionTesterService,
  type SmsirApiClientLike,
} from './smsir-connection-tester.service'
import type { SmsirConfig } from './smsir-config.schema'

describe('SmsirConnectionTesterService (T-09.06.02)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  const baseConfig: SmsirConfig = {
    api_key: 'smsir_secret_key_123',
    sender: '9830000000',
    timeout: 15,
    throughput_limit: 100,
    low_credit_threshold: 0,
  }

  const fakeClient = (overrides: Partial<SmsirApiClientLike>): SmsirApiClientLike => ({
    getCredit: async () => ({ credit: 1000 }),
    ...overrides,
  })

  it('returns ok when the credential check succeeds', async () => {
    const getCredit = vi.fn(async () => ({ credit: 2500 }))
    const service = new SmsirConnectionTesterService(fakeClient({ getCredit }))
    const result = await service.test(baseConfig)
    expect(result.ok).toBe(true)
    expect(getCredit).toHaveBeenCalledOnce()
  })

  it('fails closed when the API key is missing', async () => {
    const service = new SmsirConnectionTesterService(fakeClient({}))
    const result = await service.test({ ...baseConfig, api_key: '' })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('API key')
  })

  it('fails when the sender/line number is missing', async () => {
    const service = new SmsirConnectionTesterService(fakeClient({}))
    const result = await service.test({ ...baseConfig, sender: '' })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('sender')
  })

  it('fails when the credential check returns an error message', async () => {
    const service = new SmsirConnectionTesterService(
      fakeClient({ getCredit: async () => ({ message: 'invalid api key' }) }),
    )
    const result = await service.test(baseConfig)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('invalid api key')
  })

  it('fails without surfacing secrets when the client throws', async () => {
    const service = new SmsirConnectionTesterService(
      fakeClient({
        getCredit: async () => {
          throw new Error('network error')
        },
      }),
    )
    const result = await service.test(baseConfig)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('network error')
    expect(result.error).not.toContain(baseConfig.api_key)
  })
})