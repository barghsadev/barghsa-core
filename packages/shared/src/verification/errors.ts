/**
 * Verification-specific error codes.
 *
 * These extend the shared error codes namespace and are used for
 * API responses and internal error handling.
 */
export const VerificationErrorCodes = {
  /** The requested provider is not registered. */
  PROVIDER_NOT_FOUND: 'VERIFICATION:PROVIDER_NOT_FOUND',
  /** The provider is disabled in the current configuration. */
  PROVIDER_DISABLED: 'VERIFICATION:PROVIDER_DISABLED',
  /** The circuit breaker is open (too many recent failures). */
  CIRCUIT_OPEN: 'VERIFICATION:CIRCUIT_OPEN',
  /** The provider call timed out. */
  TIMEOUT: 'VERIFICATION:TIMEOUT',
  /** The input data failed validation before being sent to the provider. */
  INVALID_INPUT: 'VERIFICATION:INVALID_INPUT',
  /** The provider returned an unexpected or unparseable response. */
  PROVIDER_RESPONSE_ERROR: 'VERIFICATION:PROVIDER_RESPONSE_ERROR',
  /** The provider configuration is missing or malformed. */
  CONFIG_ERROR: 'VERIFICATION:CONFIG_ERROR',
} as const