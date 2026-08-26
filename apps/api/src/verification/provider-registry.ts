import { Logger } from '@nestjs/common'
import { type VerificationProviderConfig, type VerificationResult, DEFAULT_CIRCUIT_BREAKER, DEFAULT_RETRY_CONFIG, VerificationErrorCodes } from '@barghsa/shared/verification'
import { VerificationProviderAdapter } from './provider.interface.js'
import { CircuitBreaker } from './circuit-breaker.js'

/**
 * Registry of available verification providers.
 *
 * Manages provider lifecycle:
 * - Register/unregister adapters
 * - Route verification requests to the appropriate provider
 * - Apply circuit-breaking and retry logic
 * - Track provider state for observability
 */
export class VerificationProviderRegistry {
  private readonly logger = new Logger(VerificationProviderRegistry.name)
  private readonly providers = new Map<string, { adapter: VerificationProviderAdapter; breaker: CircuitBreaker }>()

  /**
   * Register a provider adapter.
   * Note: This does NOT replace existing providers — call unregister first.
   */
  register(adapter: VerificationProviderAdapter): void {
    if (this.providers.has(adapter.providerId)) {
      throw new Error(`Provider "${adapter.providerId}" is already registered`)
    }
    this.providers.set(adapter.providerId, {
      adapter,
      breaker: new CircuitBreaker(DEFAULT_CIRCUIT_BREAKER),
    })
    this.logger.log(`Verification provider registered: ${adapter.providerId} (${adapter.displayName})`)
  }

  /** Unregister a provider. */
  unregister(providerId: string): boolean {
    return this.providers.delete(providerId)
  }

  /** Get a registered adapter by ID. */
  getAdapter(providerId: string): VerificationProviderAdapter | undefined {
    return this.providers.get(providerId)?.adapter
  }

  /** List all registered provider IDs. */
  listProviders(): { providerId: string; displayName: string; state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' }[] {
    const result: { providerId: string; displayName: string; state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' }[] = []
    for (const [id, entry] of this.providers) {
      result.push({
        providerId: id,
        displayName: entry.adapter.displayName,
        state: entry.breaker.getState(),
      })
    }
    return result
  }

  /**
   * Run a verification through the named provider.
   * Applies circuit breaker, timeout, and retry logic.
   */
  async verify(
    providerId: string,
    input: Record<string, unknown>,
    config?: VerificationProviderConfig,
  ): Promise<VerificationResult> {
    const entry = this.providers.get(providerId)

    if (!entry) {
      return {
        verified: false,
        code: 'PROVIDER_ERROR',
        message: `Provider "${providerId}" is not registered`,
        durationMs: 0,
        rawResponse: { error: VerificationErrorCodes.PROVIDER_NOT_FOUND },
      }
    }

    if (config && !config.enabled) {
      return {
        verified: false,
        code: 'PROVIDER_ERROR',
        message: `Provider "${providerId}" is disabled`,
        durationMs: 0,
        rawResponse: { error: VerificationErrorCodes.PROVIDER_DISABLED },
      }
    }

    // Validate input
    const validationErrors = entry.adapter.validateInput(input)
    if (validationErrors.length > 0) {
      return {
        verified: false,
        code: 'INVALID_INPUT',
        message: `Invalid input: ${validationErrors.join('; ')}`,
        durationMs: 0,
        rawResponse: { errors: validationErrors },
      }
    }

    // Circuit breaker check
    if (entry.breaker.isOpen) {
      return {
        verified: false,
        code: 'CIRCUIT_OPEN',
        message: 'Verification service is temporarily unavailable. Please try again later.',
        durationMs: 0,
        rawResponse: { error: VerificationErrorCodes.CIRCUIT_OPEN },
      }
    }

    // Execute with timeout and retry
    const timeoutMs = config?.settings?.['timeoutMs'] ? Number(config.settings['timeoutMs']) : 10_000
    const maxRetries = config?.settings?.['maxRetries'] ? Number(config.settings['maxRetries']) : DEFAULT_RETRY_CONFIG.maxRetries

    let lastError: unknown
    const startTime = Date.now()

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await entry.breaker.call(async () => {
          // Timeout race
          const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error('Provider timeout')), timeoutMs)
          })

          const verifyPromise = entry.adapter.verify(input)
          return await Promise.race([verifyPromise, timeoutPromise])
        })

        // On success, return the result with duration
        return {
          ...result,
          durationMs: Date.now() - startTime,
        }
      } catch (error) {
        lastError = error
        if (attempt < maxRetries) {
          // Exponential backoff
          const delay = Math.min(200 * 2 ** attempt, 5_000)
          this.logger.warn(`Verification attempt ${attempt + 1} failed for provider "${providerId}": ${String(error)}. Retrying in ${delay}ms`)
          await new Promise((resolve) => setTimeout(resolve, delay))
        }
      }
    }

    // All retries exhausted
    const errorMessage = lastError instanceof Error ? lastError.message : 'Unknown error'
    const isTimeout = errorMessage === 'Provider timeout'

    return {
      verified: false,
      code: isTimeout ? 'TIMEOUT' : 'PROVIDER_ERROR',
      message: isTimeout
        ? 'Verification service did not respond in time. Please try again.'
        : `Verification failed: ${errorMessage}`,
      durationMs: Date.now() - startTime,
      rawResponse: { error: isTimeout ? VerificationErrorCodes.TIMEOUT : VerificationErrorCodes.PROVIDER_RESPONSE_ERROR },
    }
  }
}