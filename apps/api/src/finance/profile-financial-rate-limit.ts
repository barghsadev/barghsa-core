import { HttpException } from '@nestjs/common';
import { ErrorCodes } from '@barghsa/shared/errors';
import { PostgresRateLimiterStore, rateLimitKey } from '@barghsa/shared/rate-limit';

/** Charge a new intent in the same transaction as the financial write. */
export async function enforceProfileFinancialRateLimit(
  client: { query: ConstructorParameters<typeof PostgresRateLimiterStore>[0] },
  action: 'top-up' | 'payment' | 'refund-request',
  canonicalProfileId: string
): Promise<void> {
  const store = new PostgresRateLimiterStore((sql, values) => client.query(sql, values));
  const key = rateLimitKey(`wallet:${action}:profile`, canonicalProfileId);
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

/** Reject exhausted quotas before storage work. The financial write charges the actual attempt. */
export async function checkProfileFinancialRateLimit(
  client: Parameters<typeof enforceProfileFinancialRateLimit>[0],
  action: Parameters<typeof enforceProfileFinancialRateLimit>[1],
  profileId: string
): Promise<void> {
  await client.query('SAVEPOINT receipt_rate_limit', []);
  await enforceProfileFinancialRateLimit(client, action, profileId);
  await client.query('ROLLBACK TO SAVEPOINT receipt_rate_limit', []);
  await client.query('RELEASE SAVEPOINT receipt_rate_limit', []);
}
