import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const keyIdPattern = /^[a-zA-Z0-9_-]{1,40}$/;
const AUTH_DELIVERY_KEY_ENV = 'AUTH_DELIVERY_ENCRYPTION_KEY';
export const PROVIDER_SECRET_ENCRYPTION_ENV = 'PROVIDER_CONFIG_ENCRYPTION_KEY';

function key(raw: string | Buffer | undefined): Buffer | null {
  if (!raw) return null;
  if (Buffer.isBuffer(raw)) return raw;
  return /^[a-f0-9]{64}$/i.test(raw)
    ? Buffer.from(raw, 'hex')
    : createHash('sha256').update(raw).digest();
}

export function isSecretCiphertext(value: unknown): boolean {
  return typeof value === 'string' && (value.startsWith('v1:') || value.startsWith('v2:'));
}

export class SecretCipher {
  private readonly active: Buffer | null;
  private readonly previous: Buffer | null;
  private readonly activeId: string | undefined;
  private readonly previousId: string | undefined;

  constructor(
    private readonly envName: string,
    configured?: string | Buffer
  ) {
    const env = typeof process === 'undefined' ? {} : process.env;
    const prefix = envName.slice(0, -'_KEY'.length);
    this.active = key(configured ?? env[envName]);
    this.previous = configured === undefined ? key(env[`${prefix}_PREVIOUS_KEY`]) : null;
    this.activeId = configured === undefined ? env[`${envName}_ID`] || undefined : undefined;
    this.previousId =
      configured === undefined ? env[`${prefix}_PREVIOUS_KEY_ID`] || undefined : undefined;
    if (
      (this.activeId && (!this.active || !keyIdPattern.test(this.activeId))) ||
      (this.previous && !this.active) ||
      (this.previousId &&
        (!this.previous ||
          !this.activeId ||
          !keyIdPattern.test(this.previousId) ||
          this.previousId === this.activeId))
    )
      throw new Error(`Invalid ${envName} rotation configuration`);
  }

  get available(): boolean {
    return this.active !== null;
  }

  private requireActive(): Buffer {
    if (!this.active) throw new Error(`${this.envName} is not set`);
    return this.active;
  }

  private aad(context: string | undefined, id?: string) {
    return id ? JSON.stringify([this.envName, id, context ?? null]) : context;
  }

  encrypt(plaintext: string, context?: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.requireActive(), iv);
    const aad = this.aad(context, this.activeId);
    if (aad !== undefined) cipher.setAAD(Buffer.from(aad));
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return [
      ...(this.activeId ? ['v2', this.activeId] : ['v1']),
      iv.toString('base64url'),
      cipher.getAuthTag().toString('base64url'),
      encrypted.toString('base64url'),
    ].join(':');
  }

  decrypt(stored: string, context?: string): string {
    const active = this.requireActive();
    const [version, ...parts] = stored.split(':');
    const id = version === 'v2' ? parts.shift() : undefined;
    const [ivText, tagText, dataText] = parts;
    if (
      (version !== 'v1' && version !== 'v2') ||
      (version === 'v2' && (!id || !keyIdPattern.test(id))) ||
      parts.length !== 3 ||
      !ivText ||
      !tagText ||
      dataText === undefined
    )
      throw new Error('Invalid secret ciphertext');
    const iv = Buffer.from(ivText, 'base64url');
    const tag = Buffer.from(tagText, 'base64url');
    const data = Buffer.from(dataText, 'base64url');
    if (
      iv.length !== 12 ||
      tag.length !== 16 ||
      iv.toString('base64url') !== ivText ||
      tag.toString('base64url') !== tagText ||
      data.toString('base64url') !== dataText
    )
      throw new Error('Invalid secret ciphertext');

    const aad = this.aad(context, id);
    const keys = id
      ? [id === this.activeId ? active : id === this.previousId ? this.previous : null]
      : [active, this.previous];
    for (const candidate of keys) {
      if (!candidate) continue;
      try {
        const decipher = createDecipheriv('aes-256-gcm', candidate, iv);
        if (aad !== undefined) decipher.setAAD(Buffer.from(aad));
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
      } catch {
        // Unversioned ciphertext can also have been sealed with the previous key.
      }
    }
    throw new Error('Secret ciphertext could not be decrypted');
  }
}

function authDeliveryCipher(secret?: string) {
  const cipher = new SecretCipher(AUTH_DELIVERY_KEY_ENV, secret);
  if (!cipher.available) throw new Error('Auth delivery encryption key is not configured');
  return cipher;
}

export function encryptAuthDelivery(id: string, value: unknown, secret?: string): string {
  return authDeliveryCipher(secret).encrypt(JSON.stringify(value), id);
}

export function decryptAuthDelivery(id: string, value: string, secret?: string): unknown {
  return JSON.parse(authDeliveryCipher(secret).decrypt(value, id));
}

export function decryptProviderSecret(value: string): string {
  return isSecretCiphertext(value)
    ? new SecretCipher(PROVIDER_SECRET_ENCRYPTION_ENV).decrypt(value)
    : value;
}
