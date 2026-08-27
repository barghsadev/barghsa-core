import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  SmsirConnectionTesterService,
  type SmsirApiClientLike,
  type SmsirSendVerifyPayload,
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
    sendVerifyCode: async () => ({ message_id: 12345 }),
    ...overrides,
  })

  it('returns ok when the credential check succeeds', async () => {
    const getCredit = vi.fn(async () => ({ credit: 2500 }))
    const service = new SmsirConnectionTesterService(fakeClient({ getCredit }))
    const result = await service.test(baseConfig)
    expect(result.ok).toBe(true)
    expect(getCredit).toHaveBeenCalledOnce()
  })

  it('performs a live test-send to the admin mobile via the mapped template', async () => {
    const sendVerifyCode: SmsirApiClientLike['sendVerifyCode'] = vi.fn(async () => ({
      message_id: 98765,
    }))
    const service = new SmsirConnectionTesterService(fakeClient({ sendVerifyCode }))
    const config: SmsirConfig = {
      ...baseConfig,
      template_mappings: [
        { event_key: 'otp:login', template_id: '2001', variables: { code: 'c' } },
      ],
    }
    const result = await service.test(config, '989121234567', 'otp:login')
    expect(result.ok).toBe(true)
    expect(sendVerifyCode).toHaveBeenCalledOnce()
    const payload = vi.mocked(sendVerifyCode).mock.calls[0]![2] as SmsirSendVerifyPayload
    expect(payload.mobile_number).toBe('989121234567')
    expect(payload.template_id).toBe('2001')
    expect(payload.parameters).toEqual([{ name: 'c', value: 'test-code' }])
  })

  it('fails when the requested event has no template mapping', async () => {
    const sendVerifyCode = vi.fn(async () => ({ message_id: 1 }))
    const service = new SmsirConnectionTesterService(fakeClient({ sendVerifyCode }))
    const config: SmsirConfig = {
      ...baseConfig,
      template_mappings: [{ event_key: 'otp:login', template_id: '2001' }],
    }
    const result = await service.test(config, '989121234567', 'invoice:created')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('invoice:created')
    expect(sendVerifyCode).not.toHaveBeenCalled()
  })

  it('fails when the test-send is rejected by SMS.ir', async () => {
    const sendVerifyCode = vi.fn(async () => ({ message: 'template not found' }))
    const service = new SmsirConnectionTesterService(fakeClient({ sendVerifyCode }))
    const config: SmsirConfig = {
      ...baseConfig,
      template_mappings: [{ event_key: 'otp:login', template_id: '9999' }],
    }
    const result = await service.test(config, '989121234567')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('template not found')
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
