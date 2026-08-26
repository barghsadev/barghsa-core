import type { VerificationResult } from '@barghsa/shared/verification'

/**
 * Abstract provider adapter for identity verification APIs.
 *
 * Each concrete provider (e.g. national ID verification, Sabt-e-Ahval)
 * extends this base class and implements `verify()`.
 *
 * The adapter lifecycle:
 * 1. Constructed with provider-specific config.
 * 2. `check()` is called by the registry — it applies timeout, retry,
 *    and circuit-breaker logic around the concrete `verify()` method.
 * 3. `verify()` is implemented by the subclass and contains the actual
 *    HTTP call / API integration.
 */
export abstract class VerificationProviderAdapter {
  /** Unique provider identifier (e.g. 'national_id', 'sabt_ahval'). */
  abstract readonly providerId: string

  /** Human-readable display name. */
  abstract readonly displayName: string

  /**
   * The actual verification logic — implemented by each provider.
   *
   * @param input - Provider-specific input data (e.g. national ID, full name, birth date).
   * @returns A VerificationResult with the outcome.
   */
  abstract verify(input: Record<string, unknown>): Promise<VerificationResult>

  /**
   * Validate that the input data is complete and well-formed for this provider.
   *
   * @param input - The raw input data to validate.
   * @returns An array of validation error messages (empty = valid).
   */
  abstract validateInput(input: Record<string, unknown>): string[]
}