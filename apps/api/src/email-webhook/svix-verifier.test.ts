import { describe, it, expect } from 'vitest'
import { createHmac } from 'node:crypto'
import { verifySvixSignature } from './svix-verifier'

/**
 * Svix-style signature verifier (E-05, T-05.06.07).
 *
 * The verifier must reproduce exactly what the Resend/Svix delivery library
 * does: HMAC-SHA256 over `${svixId}.${svixTimestamp}.${rawPayload}` keyed with
 * the base64-decoded signing secret (the part after a `whsec_` prefix), sent
 * as `v1,<base64hmac>`. The tests sign payloads with the same algorithm.
 */

const SECRET = 'whsec_MzJiZTYwYmYyZjYwNGQ3OTk4ZmI2NDJmNTc1ZWI2ZDM'
const OTHER_SECRET = 'whsec_YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM0NTY'

function hmacBase64(secret: string, content: string): string {
  const body = secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : secret
  const key = Buffer.from(body, 'base64')
  return createHmac('sha256', key).update(content, 'utf8').digest('base64')
}

function sign(secret: string, id: string, timestamp: string, payload: string): string {
  return `v1,${hmacBase64(secret, `${id}.${timestamp}.${payload}`)}`
}

const NOW = Math.floor(Date.now() / 1000)

describe('verifySvixSignature (T-05.06.07)', () => {
  const payload = JSON.stringify({ type: 'email.delivered', data: { email_id: 'msg_1' } })

  it('accepts a validly-signed payload', () => {
    const result = verifySvixSignature(
      payload,
      {
        id: 'msg_7NeQPlPBbhCs9qgy',
        timestamp: String(NOW),
        signature: sign(SECRET, 'msg_7NeQPlPBbhCs9qgy', String(NOW), payload),
      },
      SECRET,
      NOW,
    )
    expect(result).toEqual({ ok: true })
  })

  it('accepts when multiple v1 candidates rotate (rotation)', () => {
    const stale = hmacBase64(OTHER_SECRET, `id_x.${NOW}.${payload}`)
    const current = hmacBase64(SECRET, `id_x.${NOW}.${payload}`)
    const result = verifySvixSignature(
      payload,
      {
        id: 'id_x',
        timestamp: String(NOW),
        signature: `v1,${stale},v1,${current}`,
      },
      SECRET,
      NOW,
    )
    expect(result).toEqual({ ok: true })
  })

  it('rejects a tampered payload', () => {
    const result = verifySvixSignature(
      payload + ' ',
      {
        id: 'msg_7NeQPlPBbhCs9qgy',
        timestamp: String(NOW),
        signature: sign(SECRET, 'msg_7NeQPlPBbhCs9qgy', String(NOW), payload),
      },
      SECRET,
      NOW,
    )
    expect(result).toEqual({ ok: false, reason: 'tampered' })
  })

  it('rejects a signature made with a different secret', () => {
    const result = verifySvixSignature(
      payload,
      {
        id: 'msg_7NeQPlPBbhCs9qgy',
        timestamp: String(NOW),
        signature: sign(OTHER_SECRET, 'msg_7NeQPlPBbhCs9qgy', String(NOW), payload),
      },
      SECRET,
      NOW,
    )
    expect(result).toEqual({ ok: false, reason: 'tampered' })
  })

  it('rejects missing svix headers', () => {
    const result = verifySvixSignature(
      payload,
      { id: undefined, timestamp: undefined, signature: undefined },
      SECRET,
      NOW,
    )
    expect(result).toEqual({ ok: false, reason: 'tampered' })
  })

  it('rejects an old (replayed) timestamp outside the tolerance window', () => {
    const stale = NOW - 3600 // one hour ago
    const result = verifySvixSignature(
      payload,
      {
        id: 'msg_7NeQPlPBbhCs9qgy',
        timestamp: String(stale),
        signature: sign(SECRET, 'msg_7NeQPlPBbhCs9qgy', String(stale), payload),
      },
      SECRET,
      NOW,
    )
    expect(result).toEqual({ ok: false, reason: 'replayed' })
  })

  it('rejects a future timestamp outside the tolerance window', () => {
    const future = NOW + 3600
    const result = verifySvixSignature(
      payload,
      {
        id: 'msg_7NeQPlPBbhCs9qgy',
        timestamp: String(future),
        signature: sign(SECRET, 'msg_7NeQPlPBbhCs9qgy', String(future), payload),
      },
      SECRET,
      NOW,
    )
    expect(result).toEqual({ ok: false, reason: 'replayed' })
  })

  it('rejects when no signing secret is available', () => {
    const result = verifySvixSignature(
      payload,
      {
        id: 'msg_7NeQPlPBbhCs9qgy',
        timestamp: String(NOW),
        signature: sign(SECRET, 'msg_7NeQPlPBbhCs9qgy', String(NOW), payload),
      },
      undefined,
      NOW,
    )
    expect(result).toEqual({ ok: false, reason: 'missing_secret' })
  })
})