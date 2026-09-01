import { describe, it, expect } from 'vitest'
import {
  PAYMENT_CALLBACK_TOLERANCE_SEC,
  signPaymentCallback,
  verifyPaymentCallbackSignature,
} from './payment-callback-verifier.js'

const SECRET = 'callback-secret'
const EVENT_ID = 'evt-1'
const PAYLOAD = '{"merchantOrderId":"aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa"}'

describe('verifyPaymentCallbackSignature (T-04.2.02.02)', () => {
  it('accepts a matching HMAC within the replay window', () => {
    const timestamp = '1700000000'
    const signature = signPaymentCallback(PAYLOAD, EVENT_ID, timestamp, SECRET)
    expect(
      verifyPaymentCallbackSignature(
        PAYLOAD,
        { eventId: EVENT_ID, timestamp, signature },
        SECRET,
        1700000000,
      ),
    ).toEqual({ ok: true })
  })

  it('rejects a missing secret or missing headers', () => {
    expect(
      verifyPaymentCallbackSignature(PAYLOAD, { eventId: EVENT_ID, timestamp: '1', signature: 'v1,x' }, ''),
    ).toEqual({ ok: false, reason: 'missing_secret' })
    expect(
      verifyPaymentCallbackSignature(PAYLOAD, { eventId: undefined, timestamp: '1', signature: 'v1,x' }, SECRET),
    ).toEqual({ ok: false, reason: 'missing_headers' })
  })

  it('rejects a tampered body or signature', () => {
    const timestamp = '1700000000'
    const signature = signPaymentCallback(PAYLOAD, EVENT_ID, timestamp, SECRET)
    expect(
      verifyPaymentCallbackSignature(
        '{"tampered":true}',
        { eventId: EVENT_ID, timestamp, signature },
        SECRET,
        1700000000,
      ),
    ).toEqual({ ok: false, reason: 'tampered' })
    expect(
      verifyPaymentCallbackSignature(
        PAYLOAD,
        { eventId: EVENT_ID, timestamp, signature: 'v1,AAAA' },
        SECRET,
        1700000000,
      ),
    ).toEqual({ ok: false, reason: 'tampered' })
  })

  it(`rejects timestamps outside ±${PAYMENT_CALLBACK_TOLERANCE_SEC} seconds`, () => {
    const timestamp = String(1_700_000_000 - PAYMENT_CALLBACK_TOLERANCE_SEC - 1)
    const signature = signPaymentCallback(PAYLOAD, EVENT_ID, timestamp, SECRET)
    expect(
      verifyPaymentCallbackSignature(
        PAYLOAD,
        { eventId: EVENT_ID, timestamp, signature },
        SECRET,
        1_700_000_000,
      ),
    ).toEqual({ ok: false, reason: 'replayed' })
  })
})
