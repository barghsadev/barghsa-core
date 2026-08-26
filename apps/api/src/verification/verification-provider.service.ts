import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import type { VerificationResult, VerificationProviderConfig } from '@barghsa/shared/verification'
import { getDbPool } from '@barghsa/db'
import { VerificationProviderRegistry } from './provider-registry.js'
import { StubVerificationProvider } from './providers/stub.provider.js'

/**
 * NestJS wrapper around the verification provider registry.
 *
 * Provides:
 * - Provider lifecycle (auto-register on module init)
 * - Admin configuration storage (read/write provider config from app_config)
 * - Verification execution
 * - Provider status inspection
 */
@Injectable()
export class VerificationProviderService implements OnModuleInit {
  private readonly logger = new Logger(VerificationProviderService.name)
  private readonly registry = new VerificationProviderRegistry()

  /** The config key prefix for provider configs in the app_config table. */
  private static readonly CONFIG_KEY_PREFIX = 'verification_provider_'

  onModuleInit(): void {
    // Register built-in providers
    this.registry.register(new StubVerificationProvider())
    this.logger.log('VerificationProviderService initialised with built-in providers')
  }

  /**
   * Run verification through the configured provider.
   *
   * Reads the provider config from the app_config table and routes
   * the verification request to the appropriate adapter.
   */
  async verify(
    providerId: string,
    input: Record<string, unknown>,
  ): Promise<VerificationResult> {
    const config = await this.getProviderConfig(providerId)
    return this.registry.verify(providerId, input, config ?? undefined)
  }

  /**
   * Get the configuration for a specific provider.
   * Returns null if no config is stored.
   */
  async getProviderConfig(providerId: string): Promise<VerificationProviderConfig | null> {
    const pool = getDbPool()
    const result = await pool.query(
      `SELECT value FROM app_config WHERE key = $1`,
      [`${VerificationProviderService.CONFIG_KEY_PREFIX}${providerId}`],
    )

    if (result.rows.length === 0) {
      return null
    }

    return result.rows[0]!.value as VerificationProviderConfig
  }

  /**
   * Save the configuration for a provider.
   */
  async setProviderConfig(
    providerId: string,
    config: VerificationProviderConfig,
  ): Promise<void> {
    const pool = getDbPool()
    const now = new Date()

    await pool.query(
      `INSERT INTO app_config (key, value, version, updated_at)
       VALUES ($1, $2::jsonb, 1, $3)
       ON CONFLICT (key) DO UPDATE SET value = $2::jsonb, version = app_config.version + 1, updated_at = $3`,
      [`${VerificationProviderService.CONFIG_KEY_PREFIX}${providerId}`, JSON.stringify(config), now],
    )

    // Bump global config version
    await pool.query(
      `UPDATE config_version SET version = version + 1, updated_at = $1 WHERE id = 'global'`,
      [now],
    )

    this.logger.log(`Provider config saved: ${providerId}`)
  }

  /**
   * List all registered providers with their status.
   */
  listProviders(): { providerId: string; displayName: string; state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' }[] {
    return this.registry.listProviders()
  }

  /**
   * Get a registered adapter by ID.
   */
  getAdapter(providerId: string) {
    return this.registry.getAdapter(providerId)
  }

  /**
   * Reset the circuit breaker for a specific provider.
   */
  resetCircuitBreaker(providerId: string): boolean {
    return this.registry.resetCircuitBreaker(providerId)
  }
}