import { Logger } from '@nestjs/common'
import type { VerificationResult } from '@barghsa/shared/verification'
import { VerificationProviderAdapter } from '../provider.interface.js'

/**
 * Stub provider for development and testing.
 *
 * Simulates the behaviour of a real verification provider without
 * making actual external API calls. Useful for:
 * - Development environments without API credentials
 * - Integration tests
 * - Manual QA and demos
 *
 * Verification behaviour:
 * - If the nationalId ends with '0000000000', verification always succeeds.
 * - If the nationalId ends with '9999999999', verification always fails.
 * - Otherwise, the outcome is controlled by the `stubResult` setting.
 */
export class StubVerificationProvider extends VerificationProviderAdapter {
  readonly providerId = 'stub'
  readonly displayName = 'Stub Provider (Development)'

  private readonly logger = new Logger(StubVerificationProvider.name)

  private stubResult: 'success' | 'failure' = 'success'

  /** Override the stub result for testing. */
  setStubResult(result: 'success' | 'failure'): void {
    this.stubResult = result
  }

  async verify(input: Record<string, unknown>): Promise<VerificationResult> {
    const nationalId = String(input['nationalId'] ?? '')

    this.logger.debug(`Stub verification for nationalId=${nationalId}`)

    // Simulate a small delay
    await new Promise((resolve) => setTimeout(resolve, 50))

    // Special values for deterministic testing
    if (nationalId.endsWith('0000000000')) {
      return {
        verified: true,
        code: 'VERIFIED',
        message: 'Identity verified successfully.',
        rawResponse: { provider: 'stub', nationalId, matched: true },
        durationMs: 50,
      }
    }

    if (nationalId.endsWith('9999999999')) {
      return {
        verified: false,
        code: 'NOT_FOUND',
        message: 'The provided national ID was not found in the registry.',
        rawResponse: { provider: 'stub', nationalId, matched: false },
        durationMs: 50,
      }
    }

    // Configurable result
    if (this.stubResult === 'success') {
      return {
        verified: true,
        code: 'VERIFIED',
        message: 'Identity verified successfully.',
        rawResponse: { provider: 'stub', nationalId, matched: true },
        durationMs: 50,
      }
    }

    return {
      verified: false,
      code: 'DATA_MISMATCH',
      message: 'The provided information does not match the official records.',
      rawResponse: { provider: 'stub', nationalId, matched: false },
      durationMs: 50,
    }
  }

  validateInput(input: Record<string, unknown>): string[] {
    const errors: string[] = []

    if (!input['nationalId']) {
      errors.push('nationalId is required')
    } else if (typeof input['nationalId'] !== 'string') {
      errors.push('nationalId must be a string')
    } else if (!/^\d{10}$/.test(input['nationalId'] as string)) {
      errors.push('nationalId must be a 10-digit string')
    }

    return errors
  }
}