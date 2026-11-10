import { Injectable, Logger, Inject, Optional } from '@nestjs/common';
import {
  isSecretCiphertext,
  PROVIDER_SECRET_ENCRYPTION_ENV,
  SecretCipher,
} from '@barghsa/shared/auth-delivery';
import type { EmailProviderTransport, ProviderConfigBody } from './email-provider-config.service';

export { PROVIDER_SECRET_ENCRYPTION_ENV };

/**
 * Union of every provider transport the secrets service knows how to encrypt
 * secret fields for. Email transports come from the email provider config
 * service; SMS.ir (T-09.06.02) is added here.
 */
export type ProviderTransport = EmailProviderTransport | 'smsir';

/**
 * Field-level secrets encryption for email provider configurations (E-05,
 * T-05.06.05).
 *
 * Transport-specific secret fields are encrypted before the `config` JSONB
 * blob is persisted and decrypted only when the configuration is consumed at
 * the send boundary (the SMTP/Resend connection testers today; the outbox
 * worker's email transport later). Non-secret fields remain plaintext so the
 * admin UI and lifecycle service can read them without a key.
 *
 * Guarantees:
 * - Secrets are encrypted at rest with AES-256-GCM (random 96-bit IV per
 *   value; the 128-bit auth tag is embedded, so tampering fails decryption).
 * - Versioned ciphertext supports an active and previous key. Legacy
 *   plaintext rows still decrypt as themselves during migration.
 * - The API never returns plaintext secrets: `maskConfig` emits a display
 *   value of `*`s plus the last 4 characters.
 * - A missing `PROVIDER_CONFIG_ENCRYPTION_KEY` fails closed (throws) whenever
 *   a secret field must be encrypted/decrypted; configs without secret fields
 *   never require the key.
 *
 * Key resolution: `PROVIDER_CONFIG_ENCRYPTION_KEY`. A 64-char hex value is
 * used as 32 raw bytes; any other value is SHA-256-derived to a 32-byte key.
 */

/** Injection token to override the encryption key (used by tests). */
export const PROVIDER_SECRETS_KEY = Symbol('PROVIDER_SECRETS_KEY');

/** Which top-level config fields hold secrets per transport. */
const SECRET_FIELDS: Record<ProviderTransport, readonly string[]> = {
  smtp: ['password'],
  resend: ['api_key', 'webhook_secret'],
  smsir: ['api_key'],
};

export interface ProviderMaskedConfig {
  [key: string]: unknown;
}

@Injectable()
export class ProviderSecretsService {
  private readonly logger = new Logger(ProviderSecretsService.name);
  private readonly cipher: SecretCipher;

  constructor(
    @Optional()
    @Inject(PROVIDER_SECRETS_KEY)
    key?: Buffer | string
  ) {
    this.cipher = new SecretCipher(PROVIDER_SECRET_ENCRYPTION_ENV, key);
    if (!this.available) {
      this.logger.warn(
        `${PROVIDER_SECRET_ENCRYPTION_ENV} is not set — new provider secret writes are unavailable.`
      );
    }
  }

  /** True when a key is configured, so callers can enforce fail-closed policy. */
  get available(): boolean {
    return this.cipher.available;
  }

  /** Secret field names for a transport. */
  secretFieldsFor(transport: ProviderTransport): readonly string[] {
    return SECRET_FIELDS[transport] ?? [];
  }

  /** Encrypt a single plaintext secret value. */
  encryptValue(plaintext: string): string {
    return this.cipher.encrypt(plaintext);
  }

  /** Decrypt a stored value; values without the encrypted format pass through. */
  decryptValue(stored: string): string {
    return isSecretCiphertext(stored) ? this.cipher.decrypt(stored) : stored;
  }

  /**
   * Mask a secret for API/UI display: all characters replaced with `*`
   * except the last 4. Short values are fully masked.
   */
  maskValue(value: string): string {
    if (value.length <= 4) return '*'.repeat(value.length);
    return '*'.repeat(value.length - 4) + value.slice(-4);
  }

  /**
   * Return a copy of `config` with every secret field encrypted. Non-secret
   * fields are untouched. Unknown keys are passed through as-is.
   *
   * - New nonempty secrets require the encryption key. Legacy values remain
   *   readable, but missing configuration never downgrades a new write to plaintext.
   * - Values that already look like admin-UI masked placeholders (e.g.
   *   `********cret`) are omitted from the returned object so the write path's
   *   JSONB merge preserves the existing stored secret instead of encrypting
   *   the masked placeholder and permanently corrupting it.
   */
  encryptConfig(transport: ProviderTransport, config: ProviderConfigBody): ProviderConfigBody {
    const out = { ...config };
    for (const field of SECRET_FIELDS[transport] ?? []) {
      const value = out[field];
      if (typeof value !== 'string' || value.length === 0) continue;
      // Masked display value → omit so the merge keeps the stored secret.
      if (isMaskedValue(value)) {
        delete out[field];
        continue;
      }
      out[field] = this.encryptValue(value);
    }
    return out;
  }

  /**
   * Return a copy of a stored `config` with every secret field decrypted.
   * Legacy plaintext values pass through unchanged. Used only at the send
   * boundary (connection testers / outbox worker email transport).
   */
  decryptConfig(transport: ProviderTransport, config: ProviderConfigBody): ProviderConfigBody {
    const out = { ...config };
    for (const field of SECRET_FIELDS[transport] ?? []) {
      const value = out[field];
      if (typeof value === 'string' && value.length > 0) {
        out[field] = this.decryptValue(value);
      }
    }
    return out;
  }

  /**
   * Return a copy of `config` safe for API responses / the admin UI: secret
   * fields replaced with a masked display value (last 4 chars visible),
   * non-secret fields passed through as-is. Degrades gracefully when the key
   * is missing but encrypted rows exist — the API must never break the admin
   * page over a secret it cannot decrypt.
   */
  maskConfig(transport: ProviderTransport, config: ProviderConfigBody): ProviderMaskedConfig {
    const out: ProviderMaskedConfig = {};
    for (const [key, value] of Object.entries(config)) {
      const isSecret = SECRET_FIELDS[transport]?.includes(key) ?? false;
      if (isSecret && typeof value === 'string' && value.length > 0) {
        // Decrypt to derive the real length + tail for masking, then mask.
        out[key] = this.maskConfigSecret(value);
      } else {
        out[key] = value;
      }
    }
    return out;
  }

  /** Mask a stored secret for display; never throws on an undecryptable value. */
  private maskConfigSecret(stored: string): string {
    try {
      return this.maskValue(this.decryptValue(stored));
    } catch {
      // Missing key or tampered/legacy-format blob — don't crash the admin page.
      return isEncryptedSecretValue(stored) ? '[encrypted]' : this.maskValue(stored);
    }
  }
}

export function isEncryptedSecretValue(value: unknown): boolean {
  return isSecretCiphertext(value);
}

/**
 * True when a string looks like an admin-UI masked placeholder output (one or
 * more `*`s then up to 4 visible chars), e.g. `********cret`. Used to guard the
 * update path so a masked value echoed back from the UI is never encrypted and
 * stored (which would corrupt the real secret). Plain secrets that legitimately
 * start with `*` are vanishingly rare and deliberately treated as placeholders
 * to prefer preserving the stored secret over corrupting it.
 */
export function isMaskedValue(value: string): boolean {
  if (value.length === 0) return false;
  const starCount = value.match(/^\*+/)?.[0].length ?? 0;
  if (starCount === 0) return false;
  return value.length - starCount <= 4;
}
