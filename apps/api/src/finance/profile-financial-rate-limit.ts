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
