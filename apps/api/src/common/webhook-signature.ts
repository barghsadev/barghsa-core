import { createHmac, timingSafeEqual } from 'node:crypto';

export const WEBHOOK_REPLAY_WINDOW_SECONDS = 300;

export type WebhookHmacResult = { ok: true } | { ok: false; reason: 'tampered' | 'replayed' };

export function verifyWebhookHmac(
  input: {
    eventId: string;
    timestamp: string;
    rawPayload: string;
    key: string | Buffer;
    candidates: readonly string[];
  },
  nowSeconds: number,
  toleranceSec: number
): WebhookHmacResult {
  const timestamp = Number(input.timestamp);
  if (!input.timestamp || /\D/.test(input.timestamp) || !Number.isSafeInteger(timestamp))
    return { ok: false, reason: 'tampered' };
  if (Math.abs(nowSeconds - timestamp) > toleranceSec) return { ok: false, reason: 'replayed' };

  const signedContent = `${input.eventId}.${input.timestamp}.${input.rawPayload}`;
  const expected = createHmac('sha256', input.key).update(signedContent, 'utf8').digest();
  for (const candidate of input.candidates) {
    const signature = Buffer.from(candidate, 'base64');
    if (signature.length === expected.length && timingSafeEqual(signature, expected))
      return { ok: true };
  }
  return { ok: false, reason: 'tampered' };
}
