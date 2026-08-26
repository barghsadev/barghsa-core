/**
 * Shared types for the verification provider adapter framework.
 *
 * @packageDocumentation
 */

/**
 * Supported verification modes.
 * Mirrors the admin config enum in the app_config table.
 */
export type VerificationMode = 'DISABLED' | 'MANUAL' | 'API'

/**
 * Result of a verification check against an external provider API.
 */
export interface VerificationResult {
  /** Whether the identity was successfully verified. */
  verified: boolean
  /** A stable, provider-agnostic reason code. */
  code: VerificationResultCode
  /** Human-readable detail (safe to surface to the user). */
  message: string
  /** Provider-specific raw response (for debugging / audit). */
  rawResponse?: Record<string, unknown>
  /** How long the provider took to respond (ms). */
  durationMs: number
}

/**
 * Provider-agnostic result codes.
 */
export type VerificationResultCode =
  | 'VERIFIED'
  | 'NOT_FOUND'
  | 'DATA_MISMATCH'
  | 'PROVIDER_ERROR'
  | 'TIMEOUT'
  | 'CIRCUIT_OPEN'
  | 'INVALID_INPUT'

/**
 * Configuration for a single verification provider.
 * Stored encrypted in the app_config table.
 */
export interface VerificationProviderConfig {
  /** Provider identifier (e.g. 'national_id', 'sabt_ahval'). */
  providerId: string
  /** Provider-specific settings (URL, keys, etc.). */
  settings: Record<string, string>
  /** Whether this provider is enabled. */
  enabled: boolean
}

/**
 * Circuit breaker configuration.
 */
export interface CircuitBreakerConfig {
  /** Number of consecutive failures before the circuit opens. */
  failureThreshold: number
  /** Milliseconds to wait before attempting a half-open probe. */
  resetTimeoutMs: number
  /** Maximum number of half-open probes before deciding. */
  halfOpenMaxProbes: number
}

/**
 * Retry configuration for provider calls.
 */
export interface RetryConfig {
  /** Maximum number of retry attempts. */
  maxRetries: number
  /** Base delay in ms (exponential backoff). */
  baseDelayMs: number
  /** Maximum delay in ms. */
  maxDelayMs: number
}

/**
 * Default circuit breaker configuration.
 */
export const DEFAULT_CIRCUIT_BREAKER: CircuitBreakerConfig = {
  failureThreshold: 5,
  resetTimeoutMs: 30_000,
  halfOpenMaxProbes: 3,
}

/**
 * Default retry configuration.
 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 200,
  maxDelayMs: 5_000,
}