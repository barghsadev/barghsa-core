import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * HMAC-SHA256 verifier for authenticated payment-provider callbacks
 * (T-04.2.02.02 / S-04.2.02).
 *
 * The provider signs the exact raw JSON body together with a unique
 * event id and a Unix-seconds timestamp:
 *
 *   signed_content = `${eventId}.${timestamp}.${rawPayload}`
 *   expected       = HMAC_SHA256(secret, signedContent)
 *   valid iff      a `v1,<base64hmac>` candidate matches
 *
 * The timestamp check is the replay window (±5 minutes by default).
 * Event-id uniqueness is enforced separately by the callback ledger.
 */

export interface PaymentCallbackHeaders {
  eventId: string | undefined
  timestamp: string | undefined
  signature: string | undefined
}

/** Default maximum age, in seconds, of an acceptable signature timestamp. */
export const PAYMENT_CALLBACK_TOLERANCE_SEC = 300

export type VerifyPaymentCallbackResult =
  | { ok: true }
  | { ok: false; reason: 'missing_secret' | 'missing_headers' | 'tampered' | 'replayed' }

function safeEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/**
 * Verify a payment-callback HMAC. Callers must feed the raw request
 * body: any re-parse or re-serialization invalidates the signature.
 */
export function verifyPaymentCallbackSignature(
  rawPayload: string,
  headers: PaymentCallbackHeaders,
  secret: string | undefined,
  nowSeconds = Math.floor(Date.now() / 1000),
  toleranceSec = PAYMENT_CALLBACK_TOLERANCE_SEC,
): VerifyPaymentCallbackResult {
  if (!secret) return { ok: false, reason: 'missing_secret' }
  if (!headers.eventId || !headers.timestamp || !headers.signature) {
    return { ok: false, reason: 'missing_headers' }
  }

  const ts = Number(headers.timestamp)
  if (!Number.isFinite(ts) || !Number.isInteger(ts)) {
    return { ok: false, reason: 'tampered' }
  }
  if (Math.abs(nowSeconds - ts) > toleranceSec) return { ok: false, reason: 'replayed' }

  const signedContent = `${headers.eventId}.${headers.timestamp}.${rawPayload}`
  const expectedHmac = createHmac('sha256', secret).update(signedContent, 'utf8').digest()

  const parts = headers.signature.split(',')
  const candidates: string[] = []
  for (let i = 0; i + 1 < parts.length; i++) {
    if (parts[i] === 'v1') candidates.push(parts[i + 1]!)
  }
  if (candidates.length === 0) return { ok: false, reason: 'tampered' }

  for (const candidate of candidates) {
    const received = Buffer.from(candidate, 'base64')
    if (received.length === 0) continue
    if (safeEqual(received, expectedHmac)) return { ok: true }
  }
  return { ok: false, reason: 'tampered' }
}

/** Test / fixture helper: build a `v1,<base64>` signature for a payload. */
export function signPaymentCallback(
  rawPayload: string,
  eventId: string,
  timestamp: string,
  secret: string,
): string {
  const signedContent = `${eventId}.${timestamp}.${rawPayload}`
  const digest = createHmac('sha256', secret).update(signedContent, 'utf8').digest('base64')
  return `v1,${digest}`
}
