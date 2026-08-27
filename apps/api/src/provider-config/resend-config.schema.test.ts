import { describe, it, expect } from 'vitest'
import { parseResendConfig } from './resend-config.schema'

describe('parseResendConfig (T-05.06.03)', () => {
  it('accepts the minimal required fields', () => {
    const parsed = parseResendConfig({
      api_key: 're_abc123',
      from_email: 'no-reply@example.com',
    })
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.config.api_key).toBe('re_abc123')
    expect(parsed.config.from_email).toBe('no-reply@example.com')
    expect(parsed.config.from_name).toBeUndefined()
    expect(parsed.config.sending_domain).toBeUndefined()
  })

  it('accepts a full custom config and preserves field values', () => {
    const parsed = parseResendConfig({
      api_key: 're_x',
      from_name: 'Barghsa',
      from_email: 'no-reply@example.com',
      reply_to: 'support@example.com',
      sending_domain: 'example.com',
    })
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.config.from_name).toBe('Barghsa')
    expect(parsed.config.reply_to).toBe('support@example.com')
    expect(parsed.config.sending_domain).toBe('example.com')
  })

  it('rejects a missing api_key and from_email', () => {
    const parsed = parseResendConfig({ sending_domain: 'example.com' })
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.error).toContain('api_key')
    expect(parsed.error).toContain('from_email')
  })

  it('rejects an invalid from_email and reply_to', () => {
    const parsed = parseResendConfig({
      api_key: 're_x',
      from_email: 'not-an-email',
      reply_to: 'nope',
    })
    expect(parsed.ok).toBe(false)
  })
})