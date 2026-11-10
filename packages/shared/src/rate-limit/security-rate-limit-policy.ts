import type { DbQueryFn } from './postgres-rate-limiter.js';

const minute = 60_000;
const hour = 60 * minute;

export const securityRateLimitPolicies = {
  otpDestinationHour: { ceiling: 5, windowMs: hour, prefixes: ['otp:dest:'] },
  otpDestinationDay: { ceiling: 10, windowMs: 24 * hour, prefixes: ['otp:dest:'] },
  otpNetwork: { ceiling: 20, windowMs: hour, prefixes: ['otp:ip:', 'otp:device:'] },
  otpResend: { ceiling: 3, windowMs: hour, prefixes: ['otp:resend:'] },
  otpVerify: {
    ceiling: 5,
    windowMs: minute,
    prefixes: [
      'otp:login:verify:ip:',
      'otp:verify:ip:',
      'change-username:verify:ip:',
      'add-contact:verify:ip:',
    ],
  },
  login: { ceiling: 50, windowMs: 15 * minute, prefixes: ['login:ip:', 'login:device:'] },
  passwordReset: {
    ceiling: 5,
    windowMs: hour,
    prefixes: [
      'password-reset:destination:',
      'forgot-password:ip:',
      'reset-password-verify:ip:',
      'reset-password:ip:',
      'password-reset:verify:destination:',
      'password-reset:complete:destination:',
    ],
  },
  orderSubmission: { ceiling: 5, windowMs: minute, prefixes: [] },
  wallet: {
    ceiling: 10,
    windowMs: minute,
    prefixes: [
      'wallet:top-up:profile:',
      'wallet:payment:profile:',
      'wallet:refund-request:profile:',
    ],
  },
  fileUpload: { ceiling: 20, windowMs: minute, prefixes: ['upload:profile:', 'upload:user:'] },
  aiQuestion: {
    ceiling: 5,
    windowMs: minute,
    prefixes: [
      'ai:knowledge:user:',
      'ai:website:',
      'ai:staff:',
      'ai:telegram:',
      'telegram:admission:',
    ],
  },
  aiTest: { ceiling: 10, windowMs: minute, prefixes: ['ai:test-chat:user:'] },
} as const;

export type SecurityRateLimitPolicy = keyof typeof securityRateLimitPolicies;
export const securityRateLimitPolicyKeys = Object.keys(
  securityRateLimitPolicies
) as SecurityRateLimitPolicy[];

export function securityRateLimitConfigKey(policy: SecurityRateLimitPolicy): string {
  return `security_rate_limit:${policy}`;
}

export function findSecurityRateLimitPolicy(key: string, ceiling: number, windowMs: number) {
  return securityRateLimitPolicyKeys.find((policy) => {
    const rule = securityRateLimitPolicies[policy];
    return (
      rule.ceiling === ceiling &&
      rule.windowMs === windowMs &&
      rule.prefixes.some((prefix) => key.startsWith(prefix))
    );
  });
}

// Bind the config key as $1 and the compiled ceiling as $2. A corrupt stored
// policy fails closed. Expiry uses database time and requires no cache or job.
export const effectiveSecurityRateLimitSql = `
  SELECT COALESCE((SELECT CASE
    WHEN jsonb_typeof(value->'limit') = 'number'
      AND value->>'limit' ~ '^[1-9][0-9]{0,4}$'
    THEN LEAST($2::integer, (value->>'limit')::integer, CASE
      WHEN value->'emergency' = 'null'::jsonb THEN $2::integer
      WHEN jsonb_typeof(value->'emergency'->'limit') = 'number'
        AND value->'emergency'->>'limit' ~ '^[1-9][0-9]{0,4}$'
        AND value->'emergency'->>'expiresAt' IS NOT NULL
      THEN CASE WHEN (value->'emergency'->>'expiresAt')::timestamptz > clock_timestamp()
        THEN (value->'emergency'->>'limit')::integer ELSE $2::integer END
      ELSE 0 END)
    ELSE 0 END FROM app_config WHERE key=$1), $2::integer) AS limit_value`;

export function readEffectiveSecurityRateLimit(raw: unknown, ceiling: number): number {
  if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw < 1 || raw > ceiling) {
    throw new Error('Invalid effective security rate limit');
  }
  return raw;
}

export async function queryEffectiveSecurityRateLimit(
  query: DbQueryFn,
  policy: SecurityRateLimitPolicy
): Promise<number> {
  const { ceiling } = securityRateLimitPolicies[policy];
  const result = await query(effectiveSecurityRateLimitSql, [
    securityRateLimitConfigKey(policy),
    ceiling,
  ]);
  return readEffectiveSecurityRateLimit(result.rows[0]?.limit_value, ceiling);
}
