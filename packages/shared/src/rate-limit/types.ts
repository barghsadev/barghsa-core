/**
 * Result of a single rate-limit check.
 */
export interface RateLimitResult {
  /** Whether the request is allowed (within the limit). */
  allowed: boolean;
  /** Remaining requests in the current window. */
  remaining: number;
  /** Maximum requests allowed in the window. */
  limit: number;
  /** Milliseconds until the window fully resets. */
  resetMs: number;
}

/**
 * Rate-limit store abstraction.
 *
 * The store is the only thing that differs between the PostgreSQL-backed
 * implementation and a potential Redis-backed implementation.  A composite
 * store tries Redis first and falls back to PostgreSQL.
 */
export interface RateLimiterStore {
  /**
   * Atomically increment the counter for `key` and return the resulting
   * state.  The counter is scoped to a sliding window of `windowMs`
   * milliseconds with a cap of `limit` requests.
   *
   * Implementations **must** clean up expired entries and **must** be
   * safe to call concurrently from multiple processes (or handle the
   * race gracefully without exceeding the limit by more than ~1%).
   */
  increment(key: string, limit: number, windowMs: number): Promise<RateLimitResult>;

  /**
   * Manually reset the counter for a given key (e.g. after a successful
   * OTP verification or login resets the attempt counter).
   */
  reset(key: string): Promise<void>;
}

/**
 * Logger contract — no framework dependency, mirrors the one in
 * `packages/shared/src/redis/redis-factory.ts`.
 */
export interface RateLimitLogger {
  warn(message: string, ...meta: unknown[]): void;
  error(message: string, ...meta: unknown[]): void;
}

/**
 * Key namespaces for rate-limiter keys.
 *
 * Using namespaces prevents key collisions and makes it easy to reason
 * about which limit applies where.
 */
export const RateLimitNamespace = {
  /** General API traffic per IP address. */
  API: 'api',
  /** Rate-limited endpoints such as report generation, bulk exports. */
  ENDPOINT: 'endpoint',
  /** Login attempts per username/email. */
  LOGIN: 'login',
  /** OTP verification attempts per phone/email. */
  OTP: 'otp',
  /** Password reset attempts per email. */
  PASSWORD_RESET: 'password_reset',
  /** Profile-level rate limiting (e.g., invoice downloads per user). */
  USER_ACTION: 'user_action',
} as const;

export type RateLimitNamespace = (typeof RateLimitNamespace)[keyof typeof RateLimitNamespace];

/** Build a namespaced Redis / DB key. */
export function rateLimitKey(namespace: string, ...identifiers: (string | number)[]): string {
  return [namespace, ...identifiers].join(':');
}