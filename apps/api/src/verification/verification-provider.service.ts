import { Injectable, Logger, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import type { VerificationResult, VerificationProviderConfig } from '@barghsa/shared/verification';
import { PROVIDER_SECRET_ENCRYPTION_ENV, SecretCipher } from '@barghsa/shared/auth-delivery';
import { ErrorCodes } from '@barghsa/shared/errors';
import { getDbPool } from '@barghsa/db';
import { z } from 'zod';
import { VerificationProviderRegistry } from './provider-registry.js';
import { StubVerificationProvider } from './providers/stub.provider.js';

const settingsSchema = z.record(z.string(), z.string());
const configIdentity = { providerId: z.string(), enabled: z.boolean() };
const storedConfigSchema = z.union([
  z.strictObject({ ...configIdentity, settingsCiphertext: z.string().min(1).nullable() }),
  z.strictObject({ ...configIdentity, settings: settingsSchema }),
]);

function configUnavailable() {
  return new ServiceUnavailableException({
    error: ErrorCodes.VERIFICATION_PROVIDER_UNAVAILABLE.code,
    message: 'Verification provider settings are unavailable',
  });
}

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
  private readonly logger = new Logger(VerificationProviderService.name);
  private readonly registry = new VerificationProviderRegistry();
  private readonly cipher = new SecretCipher(PROVIDER_SECRET_ENCRYPTION_ENV);

  /** The config key prefix for provider configs in the app_config table. */
  private static readonly CONFIG_KEY_PREFIX = 'verification_provider_';

  onModuleInit(): void {
    // A stub must never be registered in production, even with the flag set.
    if (
      ['development', 'test'].includes(process.env.NODE_ENV ?? '') &&
      process.env.ENABLE_VERIFICATION_STUB === 'true'
    ) {
      this.registry.register(new StubVerificationProvider());
    }
    this.logger.log('VerificationProviderService initialised with built-in providers');
  }

  /**
   * Run verification through the configured provider.
   *
   * Reads the provider config from the app_config table and routes
   * the verification request to the appropriate adapter.
   */
  async verify(providerId: string, input: Record<string, unknown>): Promise<VerificationResult> {
    if (!this.getAdapter(providerId)) return this.registry.verify(providerId, input);
    const stored = await this.readProviderConfig(providerId);
    if (!stored) return this.registry.verify(providerId, input);
    let settings: VerificationProviderConfig['settings'] = {};
    if (stored.enabled) {
      if ('settings' in stored) {
        // Existing records still work until an authorized save replaces them with sealed settings.
        settings = stored.settings;
      } else if (stored.settingsCiphertext !== null) {
        try {
          settings = settingsSchema.parse(
            JSON.parse(this.cipher.decrypt(stored.settingsCiphertext, this.configKey(providerId)))
          );
        } catch {
          throw configUnavailable();
        }
      }
    }
    return this.registry.verify(providerId, input, {
      providerId,
      enabled: stored.enabled,
      settings,
    });
  }

  private configKey(providerId: string): string {
    return `${VerificationProviderService.CONFIG_KEY_PREFIX}${providerId}`;
  }

  private async readProviderConfig(providerId: string) {
    const pool = getDbPool();
    const result = await pool.query(`SELECT value FROM app_config WHERE key = $1`, [
      this.configKey(providerId),
    ]);
    if (result.rows.length === 0) return null;
    const parsed = storedConfigSchema.safeParse(result.rows[0]!.value);
    if (!parsed.success || parsed.data.providerId !== providerId) throw configUnavailable();
    return parsed.data;
  }

  async getProviderConfigStatus(providerId: string) {
    const stored = await this.readProviderConfig(providerId);
    if (!stored) return { providerId, enabled: false, settingsConfigured: false };
    return {
      providerId,
      enabled: stored.enabled,
      settingsConfigured:
        'settings' in stored
          ? Object.keys(stored.settings).length > 0
          : stored.settingsCiphertext !== null,
    };
  }

  /**
   * Save the configuration for a provider.
   */
  async setProviderConfig(providerId: string, config: VerificationProviderConfig): Promise<void> {
    const key = this.configKey(providerId);
    let settingsCiphertext: string | null = null;
    if (Object.keys(config.settings).length > 0) {
      if (!this.cipher.available) throw configUnavailable();
      settingsCiphertext = this.cipher.encrypt(JSON.stringify(config.settings), key);
    }
    const pool = getDbPool();
    const now = new Date();

    await pool.query(
      `WITH stored AS (
         INSERT INTO app_config (key, value, version, updated_at)
         VALUES ($1, $2::jsonb, 1, $3)
         ON CONFLICT (key) DO UPDATE SET value = $2::jsonb, version = app_config.version + 1, updated_at = $3
         RETURNING 1
       )
       INSERT INTO config_version (id, version, updated_at)
       SELECT 'global', 1, $3 FROM stored
       ON CONFLICT (id) DO UPDATE SET version = config_version.version + 1, updated_at = $3`,
      [key, JSON.stringify({ providerId, enabled: config.enabled, settingsCiphertext }), now]
    );

    this.logger.log(`Provider config saved: ${providerId}`);
  }

  /**
   * List all registered providers with their status.
   */
  listProviders(): {
    providerId: string;
    displayName: string;
    state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
  }[] {
    return this.registry.listProviders();
  }

  /**
   * Get a registered adapter by ID.
   */
  getAdapter(providerId: string) {
    return this.registry.getAdapter(providerId);
  }

  /**
   * Reset the circuit breaker for a specific provider.
   */
  resetCircuitBreaker(providerId: string): boolean {
    return this.registry.resetCircuitBreaker(providerId);
  }
}
