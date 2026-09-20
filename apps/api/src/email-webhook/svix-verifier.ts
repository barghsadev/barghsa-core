import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Svix webhook signature verifier (E-05, T-05.06.07).
 *
 * Resend delivers webhook events the same way Svix does: three headers
 * identify the message and carry its HMAC-SHA256 signature —
 *
 *   svix-id          unique message id (stable across provider retries)
 *   svix-timestamp   Unix seconds when the event was signed
 *   svix-signature   `v1,<base64hmac>` (multiple are space-separated)
 *
 * The signature is computed over the exact raw request body:
 *
 *   signed_content = `${svix_id}.${svix_timestamp}.${rawPayload}`
 *   expected       = HMAC_SHA256(key, signedContent)
 *   valid iff      base64(expected) matches a `v1,` entry in `signature`
 *
 * Verification elapses on a per-endpoint signing secret (started with
 * `whsec_` in Resend, where the trailing part is the base64-encoded key).
 *
 * The timestamp check bounds the request's age to defend against replays:
 * an attacker cannot forge a valid signature (no secret), but could replay an
 * older captured one, which this window rejects.
 */

export interface SvixWebhookHeaders {
  id: string | undefined;
  timestamp: string | undefined;
  signature: string | undefined;
}

/** Default maximum age, in seconds, of an acceptable signature timestamp. */
export const DEFAULT_TOLERANCE_SEC = 300;

export type VerifySvixResult =
  | { ok: true }
  | { ok: false; reason: 'missing_secret' | 'missing_headers' | 'tampered' | 'replayed' };

/** Treat the secret string as the Svix secret encoding. */
function signingKey(secret: string): Buffer {
  const body = secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : secret;
  // Resend/Bravenkeys encode the key as base64 after the `whsec_` prefix; when
  // base64 decoding the secret part fails we fall back to the raw bytes.
  try {
    const decoded = Buffer.from(body, 'base64');
    if (decoded.length > 0) return decoded;
  } catch {
    /* not valid base64 — use raw bytes */
  }
  return Buffer.from(secret, 'utf8');
}

/** Timing-safe equality of two Buffers. */
function safeEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Verify a Svix-signed webhook. Returns `{ ok: true }` on success, or a
 * `{ ok: false, reason }` result otherwise. Callers must feed the raw request
 * body: any re-parse or re-serialization invalidates the signature.
 */
export function verifySvixSignature(
  rawPayload: string,
  headers: SvixWebhookHeaders,
  secret: string | undefined,
  nowSeconds = Math.floor(Date.now() / 1000),
  toleranceSec = DEFAULT_TOLERANCE_SEC
): VerifySvixResult {
  if (!secret) return { ok: false, reason: 'missing_secret' };
  if (
    [headers.id, headers.timestamp, headers.signature].some(
      (value) => typeof value !== 'string' || !value
    )
  ) {
    return { ok: false, reason: 'tampered' };
  }

  // Replay window: the timestamp reflects when the provider signed it; demand
  // it be within `toleranceSec` of now (allow a small margin for clock skew).
  const ts = Number(headers.timestamp);
  if (!/^\d+$/.test(headers.timestamp!) || !Number.isSafeInteger(ts))
    return { ok: false, reason: 'tampered' };
  if (Math.abs(nowSeconds - ts) > toleranceSec) return { ok: false, reason: 'replayed' };

  const signedContent = `${headers.id}.${headers.timestamp}.${rawPayload}`;
  const expectedHmac = createHmac('sha256', signingKey(secret))
    .update(signedContent, 'utf8')
    .digest();

  // Svix rotation sends independent, space-separated version/signature pairs.
  for (const candidate of headers.signature!.split(/\s+/)) {
    const match = /^v1,([A-Za-z0-9+/]{43}=)$/.exec(candidate);
    if (!match) continue;
    const received = Buffer.from(match[1]!, 'base64');
    if (safeEqual(received, expectedHmac)) return { ok: true };
  }
  return { ok: false, reason: 'tampered' };
}
