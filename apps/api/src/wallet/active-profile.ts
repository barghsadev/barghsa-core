import { HttpException, NotFoundException } from '@nestjs/common';
import { ErrorCodes } from '@barghsa/shared/errors';
import { PostgresRateLimiterStore, rateLimitKey } from '@barghsa/shared/rate-limit';

/** Call inside the transaction, before taking the wallet lock. */
export async function lockActiveTopUpProfile(
  client: {
    query: (sql: string, values?: unknown[]) => Promise<{ rows: unknown[] }>;
  },
  profileId: string
): Promise<void> {
  const result = await client.query('SELECT archived FROM profiles WHERE id=$1 FOR SHARE', [
    profileId,
  ]);
  const profile = result.rows[0] as { archived: boolean } | undefined;
  if (!profile) throw new NotFoundException('Profile not found');
  if (profile.archived !== false)
    throw new HttpException(
      {
        statusCode: 409,
        error: ErrorCodes.CONFLICT_STATE.code,
        message: 'Archived profiles cannot start wallet top-ups',
      },
      409
    );
}

/** Count new online and receipt top-ups in their existing admission transaction. */
export async function enforceProfileTopUpLimit(
  client: { query: ConstructorParameters<typeof PostgresRateLimiterStore>[0] },
  canonicalProfileId: string
): Promise<void> {
  const store = new PostgresRateLimiterStore((sql, values) => client.query(sql, values));
  const key = rateLimitKey('wallet:top-up:profile', canonicalProfileId);
  const result = await store.incrementSecurity(key, 10, 60_000);
  if (!result.allowed) {
    throw new HttpException(
      {
        statusCode: 429,
        error: ErrorCodes.RATE_LIMIT_EXCEEDED.code,
        retryAfterMs: result.resetMs,
      },
      429
    );
  }
}
