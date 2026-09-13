import { z } from 'zod';
import { encryptAuthDelivery, decryptAuthDelivery } from '../auth-delivery/crypto.js';
import { createStorageProvider } from './storage-factory.js';
import type { StorageProvider } from './storage-provider.js';

export const STORAGE_CONFIG_KEY = 'storage.active';
const endpoint = z
  .string()
  .max(2048)
  .refine((value) => {
    if (!value) return true;
    try {
      const url = new URL(value);
      return (
        ['http:', 'https:'].includes(url.protocol) &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash &&
        (url.pathname === '/' || url.pathname === '')
      );
    } catch {
      return false;
    }
  }, 'Use an HTTP(S) origin without credentials, paths or query parameters');

export const storageConfigFields = z
  .object({
    endpoint,
    region: z.string().trim().min(1).max(128),
    bucket: z.string().trim().min(1).max(255),
    accessKeyId: z.string().max(256),
    forcePathStyle: z.boolean(),
    privateEndpointUrl: endpoint,
    publicEndpointUrl: endpoint,
  })
  .strict();
export type StorageConfigFields = z.infer<typeof storageConfigFields>;
export const storageConfigUpdate = storageConfigFields
  .extend({
    version: z.number().int().min(0),
    secretAccessKey: z.string().max(4096).optional(),
  })
  .strict();
export const storedStorageConfig = storageConfigFields
  .extend({
    encryptedSecret: z.string().nullable(),
  })
  .strict();
export type StoredStorageConfig = z.infer<typeof storedStorageConfig>;

function encryptionKey() {
  const key = process.env.STORAGE_CONFIG_ENCRYPTION_KEY;
  if (!key) throw new Error('Storage configuration encryption is unavailable');
  return key;
}
export function encryptStorageSecret(secret: string): string | null {
  return secret ? encryptAuthDelivery(STORAGE_CONFIG_KEY, secret, encryptionKey()) : null;
}
export function decryptStorageSecret(secret: string | null): string {
  if (!secret) return '';
  const value = decryptAuthDelivery(STORAGE_CONFIG_KEY, secret, encryptionKey());
  if (typeof value !== 'string') throw new Error('Invalid storage secret');
  return value;
}
export function environmentStorageConfig(): StorageConfigFields & { secretAccessKey: string } {
  return {
    endpoint: process.env.S3_ENDPOINT ?? '',
    region: process.env.S3_REGION ?? '',
    bucket: process.env.S3_BUCKET ?? '',
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '',
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
    privateEndpointUrl: process.env.S3_PRIVATE_ENDPOINT ?? '',
    publicEndpointUrl: process.env.S3_PUBLIC_ENDPOINT ?? '',
  };
}

export function configuredStorageProviders(
  config: StorageConfigFields & { secretAccessKey: string },
  probe = false
) {
  const create = (endpoint: string) =>
    createStorageProvider({
      bucket: config.bucket,
      region: config.region,
      forcePathStyle: config.forcePathStyle,
      ...(probe ? { requestTimeoutMs: 5000, maxRetries: 1 } : {}),
      ...(endpoint ? { endpoint } : {}),
      ...(config.accessKeyId ? { accessKeyId: config.accessKeyId } : {}),
      ...(config.secretAccessKey ? { secretAccessKey: config.secretAccessKey } : {}),
    });
  return {
    internal: create(config.privateEndpointUrl || config.endpoint),
    browser: create(config.publicEndpointUrl || config.endpoint),
  };
}

/** Resolve durable configuration at each operation; cache only constructed SDK clients. */
export function runtimeStorageProvider(
  load: () => Promise<unknown | null>,
  unavailable: () => Error = () => new Error('Storage configuration is unavailable')
): StorageProvider {
  let closed = false;
  let cachedKey = '';
  let cached: ReturnType<typeof configuredStorageProviders> | undefined;
  async function resolveCurrent() {
    if (closed) throw unavailable();
    const value = await load();
    if (closed) throw unavailable();
    const config =
      value === null
        ? environmentStorageConfig()
        : (() => {
            const stored = storedStorageConfig.parse(value);
            return { ...stored, secretAccessKey: decryptStorageSecret(stored.encryptedSecret) };
          })();
    if (!config.bucket || !config.region) throw new Error('Storage provider is not configured');
    const key = JSON.stringify(config);
    if (!cached || key !== cachedKey) {
      cached = configuredStorageProviders(config);
      cachedKey = key;
    }
    return cached;
  }
  async function current() {
    try {
      return await resolveCurrent();
    } catch {
      throw unavailable();
    }
  }
  return {
    destroy: () => {
      closed = true;
      cached?.internal.destroy?.();
      cached?.browser.destroy?.();
      cached = undefined;
      cachedKey = '';
    },
    checkHealth: async (signal) => {
      const provider = (await current()).internal;
      if (!provider.checkHealth) throw unavailable();
      await provider.checkHealth(signal);
    },
    putObject: async (...args) => (await current()).internal.putObject(...args),
    getObject: async (...args) => (await current()).internal.getObject(...args),
    deleteObject: async (...args) => (await current()).internal.deleteObject(...args),
    listObjects: async (...args) => (await current()).internal.listObjects(...args),
    presignedPutUrl: async (...args) => (await current()).browser.presignedPutUrl(...args),
    presignedGetUrl: async (...args) => (await current()).browser.presignedGetUrl(...args),
  };
}
