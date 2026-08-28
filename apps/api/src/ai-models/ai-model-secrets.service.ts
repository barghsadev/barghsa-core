import { Injectable, Logger, Optional, Inject } from '@nestjs/common'
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

/**
 * Field-level encryption for AI model API tokens (S-09.11, T-09.11.01).
 *
 * Provider API tokens must never be stored plaintext. This service encrypts
 * each token at rest with AES-256-GCM (random 96-bit IV per value; the
 * 128-bit auth tag is embedded, so tampering fails decryption) and never
 * returns plaintext tokens through the API.
 *
 * Format: `v1:<iv-b64url>:<tag-b64url>:<data-b64url>` — the same versioned
 * envelope as the provider-secrets service (T-05.06.05), so stored blobs are
 * interchangeable if the two setters are ever consolidated. Values without
 * the `v1:` prefix are treated as legacy plaintext and pass through on
 * decrypt (backward-compatible), matching provider-secrets semantics.
 *
 * Key: `AI_MODEL_ENCRYPTION_KEY`. A 64-char hex value is used as 32 raw
 * bytes; any other value is SHA-256-derived to a 32-byte key.
 *
 * Unlike provider configs (which degrade to plaintext storage when the key is
 * missing), AI model tokens FAIL CLOSED on encrypt: creating/updating a model
 * with a token while no key is configured throws instead of storing the
 * token in clear. Tokens are credential material for outbound LLM calls and
 * must not silently degrade.
 */

export const AI_MODEL_ENCRYPTION_ENV = 'AI_MODEL_ENCRYPTION_KEY'

/** Injection token to override the encryption key (used by tests). */
export const AI_MODEL_SECRETS_KEY = Symbol('AI_MODEL_SECRETS_KEY')

/** Encrypted blob prefix (versioned so formats can evolve). */
const ENCRYPTED_VERSION = 'v1'

@Injectable()
export class AiModelSecretsService {
  private readonly logger = new Logger(AiModelSecretsService.name)
  private readonly key: Buffer | null

  constructor(
    @Optional()
    @Inject(AI_MODEL_SECRETS_KEY)
    key?: Buffer | string,
  ) {
    this.key = resolveKey(key)
    if (!this.key) {
      this.logger.warn(
        `${AI_MODEL_ENCRYPTION_ENV} is not set — AI model tokens cannot be encrypted. ` +
          'Create/update of models with an API token will fail until the key is configured.',
      )
    }
  }

  /** True when a key is configured, so callers can fail closed. */
  get available(): boolean {
    return this.key !== null
  }

  /**
   * Encrypt a plaintext API token. Throws when no key is configured — a
   * token must never be persisted in clear text.
   */
  encryptToken(plaintext: string): string {
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

  /**
   * Decrypt a stored token; values without the encrypted format pass through
   * (legacy plaintext). Throws on a malformed or tampered blob — fail closed.
   */
  decryptToken(stored: string): string {
    if (!stored.startsWith(ENCRYPTED_VERSION + ':')) return stored
    const [, ivB64, tagB64, dataB64] = stored.split(':')
    if (!ivB64 || !tagB64 || !dataB64) {
      throw new Error('AI model token: malformed encrypted value')
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
   * Mask a stored token for API/UI display: all characters replaced with `*`
   * except the last 4. Short values are fully masked.
   */
  maskValue(value: string): string {
    if (value.length <= 4) return '*'.repeat(value.length)
    return '*'.repeat(value.length - 4) + value.slice(-4)
  }

  /**
   * Mask a stored token for display; never throws on an undecryptable value
   * (missing key / tampered blob) so the admin page can still render.
   */
  maskToken(stored: string): string {
    if (stored.length === 0) return ''
    try {
      return this.maskValue(this.decryptToken(stored))
    } catch {
      return isEncryptedAiToken(stored) ? '[encrypted]' : this.maskValue(stored)
    }
  }

  private requireKey(): Buffer {
    const key = this.key
    if (!key) {
      throw new Error(
        `AI model tokens: ${AI_MODEL_ENCRYPTION_ENV} is not set; cannot encrypt/decrypt API tokens`,
      )
    }
    return key
  }
}

function resolveKey(configured?: Buffer | string): Buffer | null {
  const raw =
    configured ??
    (typeof process !== 'undefined' ? (process.env[AI_MODEL_ENCRYPTION_ENV] ?? '') : '')
  if (!raw) return null
  if (typeof raw === 'string') {
    // 64 hex chars = exactly 32 raw bytes.
    if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex')
    return createHash('sha256').update(raw).digest()
  }
  return raw
}

/** True when a value looks like an encrypted `v1:` blob. */
export function isEncryptedAiToken(value: unknown): boolean {
  return typeof value === 'string' && value.startsWith(ENCRYPTED_VERSION + ':')
}

/**
 * True when a string looks like a masked-placeholder output from this
 * service (one or more `*`s then up to 4 visible chars, e.g. `********cret`).
 * Guards the update path: a masked value echoed back from the admin UI must
 * never be re-encrypted and stored (it would corrupt the real token).
 * Plain tokens that legitimately start with `*` are treated as placeholders
 * to prefer preserving the stored token over corrupting it.
 */
export function isMaskedAiToken(value: string): boolean {
  if (value.length === 0) return false
  const starCount = value.match(/^\*+/)?.[0].length ?? 0
  if (starCount === 0) return false
  return value.length - starCount <= 4
}