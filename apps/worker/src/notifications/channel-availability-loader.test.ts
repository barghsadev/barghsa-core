import { describe, it, expect } from 'vitest'
import { loadChannelAvailabilityContext, EMPTY_AVAILABILITY_CONTEXT } from './channel-availability-loader.js'

/**
 * Channel availability loader tests (E-05, T-05.05.02).
 *
 * The loader resolves an outbox row's verified contact destinations + marketing
 * opt-in from the recipient profile/user and the per-channel preference rows,
 * and conservatively returns the empty context when the recipient is missing.
 */

function makePool(overrides: {
  contactRows?: Array<Record<string, unknown>>
  prefRows?: Array<Record<string, unknown>>
}) {
  const queries: string[] = []
  const pool = {
    async query(sql: string) {
      queries.push(sql)
      if (/FROM notification_outbox o\s+JOIN profiles p/.test(sql)) {
        return { rows: overrides.contactRows ?? [] }
      }
      if (sql.includes('FROM user_notification_preferences')) {
        return { rows: overrides.prefRows ?? [] }
      }
      return { rows: [] }
    },
  }
  return { pool, queries }
}

describe('loadChannelAvailabilityContext', () => {
  it('returns empty context when the recipient profile is not found', async () => {
    const { pool } = makePool({ contactRows: [] })
    const ctx = await loadChannelAvailabilityContext(pool, 'ob-missing')
    expect(ctx).toEqual(EMPTY_AVAILABILITY_CONTEXT)
  })

  it('marks email + sms verified from the user contact columns', async () => {
    const { pool } = makePool({
      contactRows: [{ email: 'a@example.com', mobile: '+989121234567' }],
    })
    const ctx = await loadChannelAvailabilityContext(pool, 'ob-1')
    expect(ctx.verifiedEmail).toBe(true)
    expect(ctx.verifiedPhone).toBe(true)
    expect(ctx.marketingOptedIn).toEqual({})
  })

  it('leaves unverified when the contact fields are absent', async () => {
    const { pool } = makePool({
      contactRows: [{ email: null, mobile: null }],
    })
    const ctx = await loadChannelAvailabilityContext(pool, 'ob-1')
    expect(ctx.verifiedEmail).toBe(false)
    expect(ctx.verifiedPhone).toBe(false)
  })

  it('reads marketing opt-in from user_notification_preferences', async () => {
    const { pool } = makePool({
      contactRows: [{ email: 'a@example.com', mobile: '+989121234567' }],
      prefRows: [
        { channel: 'email', marketing_opted_in: true },
        { channel: 'sms', marketing_opted_in: false },
      ],
    })
    const ctx = await loadChannelAvailabilityContext(pool, 'ob-1')
    expect(ctx.marketingOptedIn.email).toBe(true)
    expect(ctx.marketingOptedIn.sms).toBe(false)
  })

  it('ignores unknown preference channels and defaults absent channels to no consent', async () => {
    const { pool } = makePool({
      contactRows: [{ email: 'a@example.com', mobile: '+989121234567' }],
      prefRows: [{ channel: 'in_app', marketing_opted_in: true }],
    })
    const ctx = await loadChannelAvailabilityContext(pool, 'ob-1')
    expect(ctx.marketingOptedIn).toEqual({})
  })
})