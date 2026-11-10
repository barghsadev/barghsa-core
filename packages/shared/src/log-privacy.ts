import { createHmac } from 'node:crypto';

/** Keyed references for operator logs, separate from durable audit identities. */
export function privateLogId(
  kind: 'actor' | 'profile' | 'challenge' | 'token-family',
  id: string | null | undefined
): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || !id) return 'unavailable';

  const digest = createHmac('sha256', secret)
    .update(`barghsa.operator-log.v1:${kind}:${id}`)
    .digest('hex');
  return `${kind}:${digest.slice(0, 32)}`;
}
