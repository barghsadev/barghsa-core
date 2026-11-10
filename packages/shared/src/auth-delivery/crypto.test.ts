import { afterEach, expect, it, vi } from 'vitest';
import { encryptAuthDelivery, decryptAuthDelivery, SecretCipher } from './crypto.js';

afterEach(() => vi.unstubAllEnvs());

it('encrypts auth messages with random ciphertext bound to their row', () => {
  const message = { code: '123456', destination: 'mail@example.test' };
  const first = encryptAuthDelivery('row-a', message, 'test-key');
  expect(first).not.toContain(message.code);
  expect(first).not.toContain(message.destination);
  expect(encryptAuthDelivery('row-a', message, 'test-key')).not.toBe(first);
  expect(decryptAuthDelivery('row-a', first, 'test-key')).toEqual(message);
  expect(() => decryptAuthDelivery('row-b', first, 'test-key')).toThrow();
  expect(() => decryptAuthDelivery('row-a', first, 'wrong-key')).toThrow();
  const parts = first.split(':');
  const bytes = Buffer.from(parts[3]!, 'base64url');
  bytes[0] = bytes[0]! ^ 1;
  parts[3] = bytes.toString('base64url');
  expect(() => decryptAuthDelivery('row-a', parts.join(':'), 'test-key')).toThrow();
});

it('fails closed when the encryption key is missing', () => {
  vi.stubEnv('AUTH_DELIVERY_ENCRYPTION_KEY', '');
  expect(() => encryptAuthDelivery('row', { code: '123456' })).toThrow('not configured');
});

it('opens both legacy and identified auth deliveries through a staged key swap', () => {
  const row = 'historical-outbox-row';
  const payload = { code: '423153' };
  const legacy = 'v1:AAECAwQFBgcICQoL:dsELPYoZjR_eMORblCf1mw:tf9AOVeBh8Tu3LxS38HSkiU';
  vi.stubEnv('AUTH_DELIVERY_ENCRYPTION_KEY', 'legacy-format-fixture-key');
  vi.stubEnv('AUTH_DELIVERY_ENCRYPTION_KEY_ID', 'earlier');
  vi.stubEnv('AUTH_DELIVERY_ENCRYPTION_PREVIOUS_KEY', 'next-fixture-key');
  vi.stubEnv('AUTH_DELIVERY_ENCRYPTION_PREVIOUS_KEY_ID', 'next');
  const earlier = encryptAuthDelivery(row, payload);
  expect(earlier).toMatch(/^v2:earlier:/);
  const readerBeforeSwap = new SecretCipher('AUTH_DELIVERY_ENCRYPTION_KEY');

  vi.stubEnv('AUTH_DELIVERY_ENCRYPTION_KEY', 'next-fixture-key');
  vi.stubEnv('AUTH_DELIVERY_ENCRYPTION_KEY_ID', 'next');
  vi.stubEnv('AUTH_DELIVERY_ENCRYPTION_PREVIOUS_KEY', 'legacy-format-fixture-key');
  vi.stubEnv('AUTH_DELIVERY_ENCRYPTION_PREVIOUS_KEY_ID', 'earlier');
  const next = encryptAuthDelivery(row, payload);
  expect(next).toMatch(/^v2:next:/);
  expect(next).not.toContain(payload.code);
  expect(JSON.parse(readerBeforeSwap.decrypt(next, row))).toEqual(payload);
  for (const ciphertext of [legacy, earlier, next]) {
    expect(decryptAuthDelivery(row, ciphertext)).toEqual(payload);
    expect(() => decryptAuthDelivery('another-row', ciphertext)).toThrow();
  }
  expect(() => decryptAuthDelivery(row, next.replace('v2:next:', 'v2:earlier:'))).toThrow();
  expect(() => decryptAuthDelivery(row, next.replace('v2:next:', 'v2:unknown:'))).toThrow();
  expect(() => decryptAuthDelivery(row, next + '!')).toThrow();
  vi.stubEnv('STORAGE_CONFIG_ENCRYPTION_KEY', 'next-fixture-key');
  vi.stubEnv('STORAGE_CONFIG_ENCRYPTION_KEY_ID', 'next');
  expect(() => new SecretCipher('STORAGE_CONFIG_ENCRYPTION_KEY').decrypt(next, row)).toThrow();

  vi.stubEnv('AUTH_DELIVERY_ENCRYPTION_PREVIOUS_KEY', undefined);
  vi.stubEnv('AUTH_DELIVERY_ENCRYPTION_PREVIOUS_KEY_ID', undefined);
  expect(decryptAuthDelivery(row, next)).toEqual(payload);
  expect(() => decryptAuthDelivery(row, earlier)).toThrow();
  expect(() => decryptAuthDelivery(row, legacy)).toThrow();
});

it('rejects ambiguous key identifiers before writing ciphertext', () => {
  vi.stubEnv('AUTH_DELIVERY_ENCRYPTION_KEY', 'active-fixture-key');
  vi.stubEnv('AUTH_DELIVERY_ENCRYPTION_KEY_ID', 'duplicate');
  vi.stubEnv('AUTH_DELIVERY_ENCRYPTION_PREVIOUS_KEY', 'previous-fixture-key');
  vi.stubEnv('AUTH_DELIVERY_ENCRYPTION_PREVIOUS_KEY_ID', 'duplicate');
  expect(() => encryptAuthDelivery('row', {})).toThrow('rotation configuration');
});
