import { isSecretCiphertext, SecretCipher } from '../auth-delivery/crypto.js';

/**
 * Field-level encryption for AI model API tokens (S-09.11, T-09.11.01).
 *
 * Provider API tokens must never be stored plaintext. This service encrypts
 * each token at rest with AES-256-GCM (random 96-bit IV per value; the
 * 128-bit auth tag is embedded, so tampering fails decryption) and never
 * returns plaintext tokens through the API.
 *
 * The shared envelope reads existing v1 records and supports identified
 * active and previous keys. Unprefixed legacy plaintext remains readable.
 *
 * Key: `AI_MODEL_ENCRYPTION_KEY`. A 64-char hex value is used as 32 raw
 * bytes; any other value is SHA-256-derived to a 32-byte key.
 *
 * AI model tokens fail closed on encrypt: creating/updating a model
 * with a token while no key is configured throws instead of storing the
 * token in clear. Tokens are credential material for outbound LLM calls and
 * must not silently degrade.
 */

export const AI_MODEL_ENCRYPTION_ENV = 'AI_MODEL_ENCRYPTION_KEY';

/** Injection token to override the encryption key (used by tests). */
export const AI_MODEL_SECRETS_KEY = Symbol('AI_MODEL_SECRETS_KEY');

export class AiModelSecrets {
  private readonly cipher: SecretCipher;

  constructor(key?: Buffer | string) {
    this.cipher = new SecretCipher(AI_MODEL_ENCRYPTION_ENV, key);
  }

  /** True when a key is configured, so callers can fail closed. */
  get available(): boolean {
    return this.cipher.available;
  }

  /**
   * Encrypt a plaintext API token. Throws when no key is configured — a
   * token must never be persisted in clear text.
   */
  encryptToken(plaintext: string): string {
    return this.cipher.encrypt(plaintext);
  }

  /**
   * Decrypt a stored token; values without the encrypted format pass through
   * (legacy plaintext). Throws on a malformed or tampered blob — fail closed.
   */
  decryptToken(stored: string): string {
    return isSecretCiphertext(stored) ? this.cipher.decrypt(stored) : stored;
  }

  /**
   * Mask a stored token for API/UI display: all characters replaced with `*`
   * except the last 4. Short values are fully masked.
   */
  maskValue(value: string): string {
    if (value.length <= 4) return '*'.repeat(value.length);
    return '*'.repeat(value.length - 4) + value.slice(-4);
  }

  /**
   * Mask a stored token for display; never throws on an undecryptable value
   * (missing key / tampered blob) so the admin page can still render.
   */
  maskToken(stored: string): string {
    if (stored.length === 0) return '';
    try {
      return this.maskValue(this.decryptToken(stored));
    } catch {
      return isEncryptedAiToken(stored) ? '[encrypted]' : this.maskValue(stored);
    }
  }
}

/** True when a value uses a supported encrypted envelope prefix. */
export function isEncryptedAiToken(value: unknown): boolean {
  return isSecretCiphertext(value);
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
  if (value.length === 0) return false;
  const starCount = value.match(/^\*+/)?.[0].length ?? 0;
  if (starCount === 0) return false;
  return value.length - starCount <= 4;
}
