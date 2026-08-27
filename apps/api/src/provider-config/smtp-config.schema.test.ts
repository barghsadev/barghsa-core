import { describe, it, expect } from 'vitest'
import { parseSmtpConfig } from './smtp-config.schema'

describe('parseSmtpConfig (T-05.06.02)', () => {
  it('applies defaults for port, security and timeouts', () => {
    const parsed = parseSmtpConfig({ host: 'smtp.example.com', from_email: 'a@example.com' })
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.config.port).toBe(587)
    expect(parsed.config.security).toBe('STARTTLS')
    expect(parsed.config.connection_timeout).toBe(10)
    expect(parsed.config.command_timeout).toBe(15)
  })

  it('accepts a full custom config and preserves field values', () => {
    const parsed = parseSmtpConfig({
      host: 'mail.example.com',
      port: 465,
      security: 'TLS',
      username: 'admin',
      password: 'pw',
      connection_timeout: 20,
      command_timeout: 30,
      from_name: 'Barghsa',
      from_email: 'no-reply@example.com',
      reply_to: 'support@example.com',
    })
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.config.port).toBe(465)
    expect(parsed.config.security).toBe('TLS')
    expect(parsed.config.username).toBe('admin')
    expect(parsed.config.reply_to).toBe('support@example.com')
  })

  it('rejects missing host and from_email', () => {
    const parsed = parseSmtpConfig({ port: 587 })
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.error).toContain('host')
    expect(parsed.error).toContain('from_email')
  })

  it('rejects an invalid security enum and invalid email', () => {
    const parsed = parseSmtpConfig({
      host: 'h',
      from_email: 'not-an-email',
      security: 'BOGUS',
    })
    expect(parsed.ok).toBe(false)
  })
})
