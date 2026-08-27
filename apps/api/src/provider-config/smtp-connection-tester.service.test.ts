import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SmtpConnectionTesterService } from './smtp-connection-tester.service'
import { SmtpNetworkGuard } from './smtp-network-guard'
import type { SmtpConfig } from './smtp-config.schema'

describe('SmtpConnectionTesterService (T-05.06.02)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  const baseConfig = {
    host: 'smtp.example.com',
    port: 587,
    security: 'STARTTLS',
    connection_timeout: 10,
    command_timeout: 15,
    from_email: 'noreply@example.com',
  } as const

  it('returns ok when the handshake verifies', async () => {
    const verify = vi.fn(async () => true)
    const closed = vi.fn()
    const service = new SmtpConnectionTesterService(
      () => ({ verify, close: closed }),
      new SmtpNetworkGuard({ resolve: async () => ['93.184.216.34'] }),
    )
    const result = await service.test(baseConfig)
    expect(result.ok).toBe(true)
    expect(result.error).toBeUndefined()
    expect(verify).toHaveBeenCalledOnce()
    expect(closed).toHaveBeenCalledOnce()
  })

  it('returns a failing result when the handshake rejects', async () => {
    const service = new SmtpConnectionTesterService(
      () => ({
        verify: async () => {
          throw new Error('535 5.7.8 Authentication credentials invalid')
        },
      }),
      new SmtpNetworkGuard({ resolve: async () => ['93.184.216.34'] }),
    )
    const result = await service.test(baseConfig)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('Authentication credentials')
  })

  it('redacts the configured password from error messages', async () => {
    const secret = 'super-secret-pw-123'
    const service = new SmtpConnectionTesterService(
      () => ({
        verify: async () => {
          throw new Error(`login failed for "${secret}"`)
        },
      }),
      new SmtpNetworkGuard({ resolve: async () => ['93.184.216.34'] }),
    )
    const result = await service.test({ ...baseConfig, username: 'bob', password: secret })
    expect(result.ok).toBe(false)
    expect(result.error).not.toContain(secret)
    expect(result.error).toContain('••••')
  })

  it('rejects a private destination before any transport is created', async () => {
    const createTransport = vi.fn()
    const guard = new SmtpNetworkGuard({ resolve: async () => ['10.0.0.1'] })
    const service = new SmtpConnectionTesterService(createTransport, guard)
    const result = await service.test(baseConfig)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('blocked')
    // createTransport must never be called for a blocked destination.
    expect(createTransport).not.toHaveBeenCalled()
  })
})