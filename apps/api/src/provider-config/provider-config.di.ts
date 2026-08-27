/**
 * Provider-config DI tokens + pool types (E-05, T-05.06.x).
 *
 * Extracted from `email-provider-config.service.ts` so the email circuit
 * breaker (T-05.06.06) can inject the same optional query-pool override
 * without creating a runtime circular import (the config service imports the
 * breaker service, and the breaker used to import the token back out of the
 * config service — a TDZ hazard under the build's module evaluation order).
 *
 * The token is re-exported from `email-provider-config.service.ts` for
 * backward compatibility with existing imports.
 */

// ---------------------------------------------------------------------------
// Pool abstraction (matches the `pg` Pool.shape used at runtime and the mock
// pool used in tests: both expose `query` and `connect()`).
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface PoolClient {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }>
  release: () => void
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface ProviderPool {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }>
  connect: () => Promise<PoolClient>
}

/**
 * Injection token for an optional query-pool override. Not registered in the
 * module, so Nest resolves it to `undefined` (thanks to `@Optional()`) and the
 * services fall back to the shared `getDbPool()` pool. Tests construct the
 * services directly with a mock pool as the first constructor argument.
 */
export const PROVIDER_CONFIG_POOL = Symbol('PROVIDER_CONFIG_POOL')