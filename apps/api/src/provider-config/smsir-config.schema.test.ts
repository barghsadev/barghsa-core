import { describe, it, expect } from 'vitest'
import { parseSmsirConfig } from './smsir-config.schema'

describe('parseSmsirConfig (T-09.06.02)', () => {
  it('accepts the minimal required fields', () => {
    const parsed = parseSmsirConfig({
      api_key: 'smsir_key_abc',
      sender: '9830000000',
    })
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.config.api_key).toBe('smsir_key_abc')
    expect(parsed.config.sender).toBe('9830000000')
    expect(parsed.config.timeout).toBe(15)
    expect(parsed.config.throughput_limit).toBe(100)
    expect(parsed.config.low_credit_threshold).toBe(0)
    expect(parsed.config.template_mappings).toBeUndefined()
  })

  it('accepts a full config with template mappings', () => {
    const parsed = parseSmsirConfig({
      api_key: 'smsir_key_abc',
      sender: '9830000000',
      timeout: 20,
      throughput_limit: 200,
      low_credit_threshold: 1000,
      template_mappings: [
        {
          event_key: 'otp:login',
          template_id: '2001',
          variables: { code: 'code', name: 'name' },
        },
      ],
    })
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.config.timeout).toBe(20)
    expect(parsed.config.throughput_limit).toBe(200)
    expect(parsed.config.low_credit_threshold).toBe(1000)
    expect(parsed.config.template_mappings?.[0]?.event_key).toBe('otp:login')
    expect(parsed.config.template_mappings?.[0]?.template_id).toBe('2001')
    expect(parsed.config.template_mappings?.[0]?.variables?.code).toBe('code')
  })

  it('rejects a missing api_key and sender', () => {
    const parsed = parseSmsirConfig({})
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.error).toContain('api_key')
    expect(parsed.error).toContain('sender')
  })

  it('rejects an empty api_key', () => {
    const parsed = parseSmsirConfig({ api_key: '', sender: '9830000000' })
    expect(parsed.ok).toBe(false)
  })

  it('rejects an empty template_id in a mapping', () => {
    const parsed = parseSmsirConfig({
      api_key: 'k',
      sender: '9830000000',
      template_mappings: [{ event_key: 'otp:login', template_id: '' }],
    })
    expect(parsed.ok).toBe(false)
  })
})