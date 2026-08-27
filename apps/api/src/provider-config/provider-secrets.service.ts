import { Injectable, Logger, Inject, Optional } from '@nestjs/common'
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import type { EmailProviderTransport, ProviderConfigBody } from './email-provider-config.service'

/**
 * Union of every provider transport the secrets service knows how to encrypt
 * secret fields for. Email transports come from the email provider config
 * service; SMS.ir (T-09.06.02) is added here.
 */
export type ProviderTransport = EmailProviderTransport | 'smsir'

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
 * - Encrypted values are prefixed `v1:` so legacy plaintext rows (from before
 *   this task) still decrypt as themselves — backward-compatible migration.
 * - The API never returns plaintext secrets: `maskConfig` emits a display
 *   value of `*`s plus the last 4 characters.
 * - A missing `PROVIDER_CONFIG_ENCRYPTION_KEY` fails closed (throws) whenever
 *   a secret field must be encrypted/decrypted; configs without secret fields
 *   never require the key.
 *
 * Key resolution: `PROVIDER_CONFIG_ENCRYPTION_KEY`. A 64-char hex value is
 * used as 32 raw bytes; any other value is SHA-256-derived to a 32-byte key.
 */

export const PROVIDER_SECRET_ENCRYPTION_ENV = 'PROVIDER_CONFIG_ENCRYPTION_KEY'

/** Injection token to override the encryption key (used by tests). */
export const PROVIDER_SECRETS_KEY = Symbol('PROVIDER_SECRETS_KEY')

/** Which top-level config fields hold secrets per transport. */
const SECRET_FIELDS: Record<ProviderTransport, readonly string[]> = {
  smtp: ['password'],
  resend: ['api_key', 'webhook_secret'],
  smsir: ['api_key'],
}

/** Encrypted blob prefix (versioned so formats can evolve). */
const ENCRYPTED_VERSION = 'v1'

export interface ProviderMaskedConfig {
  [key: string]: unknown
}

@Injectable()
export class ProviderSecretsService {
  private readonly logger = new Logger(ProviderSecretsService.name)
  private readonly key: Buffer | null

  constructor(
    @Optional()
    @Inject(PROVIDER_SECRETS_KEY)
    key?: Buffer | string,
  ) {
    this.key = resolveKey(key)
    if (!this.key) {
      this.logger.warn(
        `${PROVIDER_SECRET_ENCRYPTION_ENV} is not set — secrets will be stored PLAINTEXT ` +
          'when provider configs are created. Set it to encrypt secrets at rest.',
      )
    }
  }

  /** True when a key is configured, so callers can enforce fail-closed policy. */
  get available(): boolean {
    return this.key !== null
  }

  /** Secret field names for a transport. */
  secretFieldsFor(transport: ProviderTransport): readonly string[] {
    return SECRET_FIELDS[transport] ?? []
  }

  /** Encrypt a single plaintext secret value. */
  encryptValue(plaintext: string): string {
    const key = this.requireKey()
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', key, iv)
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
    const tag = cipher.getAuthTag()
    return [
      ENCRYPTED_VERSION,
      iv.toString('base64url'),
      tag.toString('base64url'),
      encrypted.toString('base64url'),
    ].join(':')
  }

  /** Decrypt a stored value; values without the encrypted format pass through. */
  decryptValue(stored: string): string {
    if (!stored.startsWith(ENCRYPTED_VERSION + ':')) return stored
    const [, ivB64, tagB64, dataB64] = stored.split(':')
    if (!ivB64 || !tagB64 || !dataB64) {
      // Malformed encrypted blob — fail closed rather than guess.
      throw new Error('Provider secrets: malformed encrypted value')
    }
    const key = this.requireKey()
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64url'))
    decipher.setAuthTag(Buffer.from(tagB64, 'base64url'))
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(dataB64, 'base64url')),
      decipher.final(),
    ])
    return decrypted.toString('utf8')
  }

  /**
   * Mask a secret for API/UI display: all characters replaced with `*`
   * except the last 4. Short values are fully masked.
   */
  maskValue(value: string): string {
    if (value.length <= 4) return '*'.repeat(value.length)
    return '*'.repeat(value.length - 4) + value.slice(-4)
  }

  /**
   * Return a copy of `config` with every secret field encrypted. Non-secret
   * fields are untouched. Unknown keys are passed through as-is.
   *
   * - When no key is configured, secret fields are passed through as plaintext
   *   (matching the documented/`.env.example` behavior: configs can still be
   *   created, they just won't be encrypted at rest).
   * - Values that already look like admin-UI masked placeholders (e.g.
   *   `********cret`) are omitted from the returned object so the write path's
   *   JSONB merge preserves the existing stored secret instead of encrypting
   *   the masked placeholder and permanently corrupting it.
   */
  encryptConfig(transport: ProviderTransport, config: ProviderConfigBody): ProviderConfigBody {
    const out = { ...config }
    for (const field of SECRET_FIELDS[transport] ?? []) {
      const value = out[field]
      if (typeof value !== 'string' || value.length === 0) continue
      // Masked display value → omit so the merge keeps the stored secret.
      if (isMaskedValue(value)) {
        delete out[field]
        continue
      }
      if (!this.available) {
        // No key: store plaintext (documented degradation), not fail.
        this.logger.warn(
          `Provider owners: storing secret field "${field}" PLAINTEXT because ${PROVIDER_SECRET_ENCRYPTION_ENV} is not set`,
        )
        continue
      }
      out[field] = this.encryptValue(value)
    }
    return out
  }

  /**
   * Return a copy of a stored `config` with every secret field decrypted.
   * Legacy plaintext values pass through unchanged. Used only at the send
   * boundary (connection testers / outbox worker email transport).
   */
  decryptConfig(transport: ProviderTransport, config: ProviderConfigBody): ProviderConfigBody {
    const out = { ...config }
    for (const field of SECRET_FIELDS[transport] ?? []) {
      const value = out[field]
      if (typeof value === 'string' && value.length > 0) {
        out[field] = this.decryptValue(value)
      }
    }
    return out
  }

  /**
   * Return a copy of `config` safe for API responses / the admin UI: secret
   * fields replaced with a masked display value (last 4 chars visible),
   * non-secret fields passed through as-is. Degrades gracefully when the key
   * is missing but encrypted rows exist — the API must never break the admin
   * page over a secret it cannot decrypt.
   */
  maskConfig(transport: ProviderTransport, config: ProviderConfigBody): ProviderMaskedConfig {
    const out: ProviderMaskedConfig = {}
    for (const [key, value] of Object.entries(config)) {
      const isSecret = SECRET_FIELDS[transport]?.includes(key) ?? false
      if (isSecret && typeof value === 'string' && value.length > 0) {
        // Decrypt to derive the real length + tail for masking, then mask.
        out[key] = this.maskConfigSecret(value)
      } else {
        out[key] = value
      }
    }
    return out
  }

  /** Mask a stored secret for display; never throws on an undecryptable value. */
  private maskConfigSecret(stored: string): string {
    try {
      return this.maskValue(this.decryptValue(stored))
    } catch {
      // Missing key or tampered/legacy-format blob — don't crash the admin page.
      return isEncryptedSecretValue(stored) ? '[encrypted]' : this.maskValue(stored)
    }
  }

  private requireKey(): Buffer {
    const key = this.key
    if (!key) {
      throw new Error(
        `Provider secrets: ${PROVIDER_SECRET_ENCRYPTION_ENV} is not set; cannot encrypt/decrypt provider secrets`,
      )
    }
    return key
  }
}

function resolveKey(configured?: Buffer | string): Buffer | null {
  const raw =
    configured ??
    (typeof process !== 'undefined' ? (process.env[PROVIDER_SECRET_ENCRYPTION_ENV] ?? '') : '')
  if (!raw) return null
  if (typeof raw === 'string') {
    // 64 hex chars = exactly 32 raw bytes.
    if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex')
    return createHash('sha256').update(raw).digest()
  }
  return raw
}

export function isEncryptedSecretValue(value: unknown): boolean {
  return typeof value === 'string' && value.startsWith(ENCRYPTED_VERSION + ':')
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
  if (value.length === 0) return false
  const starCount = value.match(/^\*+/)?.[0].length ?? 0
  if (starCount === 0) return false
  return value.length - starCount <= 4
}