import { describe, it, expect } from 'vitest'
import { InAppNotificationTransport } from './in-app-transport.js'
import type { NotificationSendPayload } from '@barghsa/shared/notifications'

/**
 * In-app transport adapter tests (E-05, T-05.02.01).
 *
 * The adapter's contract is exercised with a recording fake pool: it must
 * INSERT one `in_app_notifications` row with the columns derived from the
 * dispatch payload, use `payload.profileId` as the recipient profile, and
 * return a `delivered` result whose `providerRef` is the inserted row id.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makePool(insertId: string | null = 'ian-1') {
  const inserts: Array<{ sql: string; params: unknown[] }> = []
  const pool = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async query(sql: string, params?: any[]) {
      inserts.push({ sql, params: params ?? [] })
      const rows = insertId === null ? [] : [{ id: insertId }]
      return { rows, rowCount: rows.length }
    },
  }
  return { pool, inserts }
}

const basePayload: NotificationSendPayload = {
  idempotencyKey: 'k1',
  channel: 'in_app',
  recipientId: 'user-1',
  profileId: 'profile-1',
  eventKey: 'profile_verified',
  payload: { name: 'Morteza' },
}

describe('InAppNotificationTransport', () => {
  it('inserts a row for the profile and returns delivered with the row id', async () => {
    const { pool, inserts } = makePool('ian-abc')
    const transport = new InAppNotificationTransport(pool)

    const result = await transport.send(basePayload)

    expect(result.status).toBe('delivered')
    expect(result.providerRef).toBe('ian-abc')
    expect(inserts).toHaveLength(1)
    const insert = inserts[0]!
    expect(insert.sql).toContain('INSERT INTO in_app_notifications')
    // [ profile_id, type, title_i18n_key, body_i18n_key, params ]
    const p = insert.params
    expect(p[0]).toBe('profile-1')
    expect(p[1]).toBe('profile_verified')
    // Derived i18n keys from the event type.
    expect(p[2]).toBe('notifications.profile_verified.title')
    expect(p[3]).toBe('notifications.profile_verified.body')
    // Payload interpolation vars are serialized to JSONB.
    expect(JSON.parse(p[4] as string)).toEqual({ name: 'Morteza' })
    expect(p[5]).toBeNull()
  })

  it('persists a same-origin relative link_route from the dispatch payload', async () => {
    const { pool, inserts } = makePool()
    const transport = new InAppNotificationTransport(pool)

    await transport.send({
      ...basePayload,
      eventKey: 'finance.chargeback_unresolved',
      payload: { event_id: 'evt-1', link_route: '/admin' },
    })

    expect(inserts[0]!.params[2]).toBe('notifications.finance.chargeback_unresolved.title')
    expect(inserts[0]!.params[3]).toBe('notifications.finance.chargeback_unresolved.body')
    expect(inserts[0]!.params[5]).toBe('/admin')
  })

  it('ignores absolute or protocol-relative link_route values', async () => {
    const { pool, inserts } = makePool()
    const transport = new InAppNotificationTransport(pool)

    await transport.send({
      ...basePayload,
      payload: { link_route: 'https://evil.example/admin' },
    })
    expect(inserts[0]!.params[5]).toBeNull()

    await transport.send({
      ...basePayload,
      payload: { link_route: '//evil.example/admin' },
    })
    expect(inserts[1]!.params[5]).toBeNull()
  })

  it('serializes an empty payload as an empty object', async () => {
    const { pool, inserts } = makePool()
    const transport = new InAppNotificationTransport(pool)

    await transport.send({ ...basePayload, payload: {} })

    expect(JSON.parse(inserts[0]!.params[4] as string)).toEqual({})
  })

  it('throws when no profileId is present (cannot scope the row)', async () => {
    const { pool, inserts } = makePool()
    const transport = new InAppNotificationTransport(pool)

    const payload: NotificationSendPayload = { ...basePayload, profileId: null as unknown as string }
    await expect(transport.send(payload)).rejects.toThrow(/requires a profileId/)
    // A rejected send must not leave a partial row.
    expect(inserts).toHaveLength(0)
  })

  it('throws when the insert returns no id (delivery genuinely failed)', async () => {
    const { pool } = makePool(null)
    const transport = new InAppNotificationTransport(pool)

    await expect(transport.send(basePayload)).rejects.toThrow(/did not return a row id/)
  })

  it('exposes the in_app channel', () => {
    const transport = new InAppNotificationTransport()
    expect(transport.channel).toBe('in_app')
  })
})
