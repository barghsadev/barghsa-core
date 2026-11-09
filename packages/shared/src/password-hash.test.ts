import { afterEach, beforeEach, expect, it, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('PASSWORD_ARGON2_MEMORY_KIB', undefined);
  vi.stubEnv('PASSWORD_ARGON2_ITERATIONS', undefined);
  vi.stubEnv('PASSWORD_ARGON2_PARALLELISM', undefined);
});

afterEach(() => vi.unstubAllEnvs());

it('retains the established Argon2id policy when no overrides are configured', async () => {
  vi.stubEnv('PASSWORD_ARGON2_ITERATIONS', '');
  const { PASSWORD_HASH_OPTIONS } = await import('./password-hash.js');

  expect(PASSWORD_HASH_OPTIONS).toEqual({
    type: 2,
    version: 19,
    memoryCost: 37 * 1024,
    timeCost: 3,
    parallelism: 1,
    hashLength: 32,
  });
});

it('accepts bounded environment overrides without changing the algorithm or output size', async () => {
  vi.stubEnv('PASSWORD_ARGON2_MEMORY_KIB', '65536');
  vi.stubEnv('PASSWORD_ARGON2_ITERATIONS', '6');
  vi.stubEnv('PASSWORD_ARGON2_PARALLELISM', '2');
  const { PASSWORD_HASH_OPTIONS } = await import('./password-hash.js');

  expect(PASSWORD_HASH_OPTIONS).toEqual({
    type: 2,
    version: 19,
    memoryCost: 65536,
    timeCost: 6,
    parallelism: 2,
    hashLength: 32,
  });
});

it.each([
  ['PASSWORD_ARGON2_MEMORY_KIB', '37887'],
  ['PASSWORD_ARGON2_MEMORY_KIB', '65537'],
  ['PASSWORD_ARGON2_ITERATIONS', '2'],
  ['PASSWORD_ARGON2_ITERATIONS', '7'],
  ['PASSWORD_ARGON2_PARALLELISM', '0'],
  ['PASSWORD_ARGON2_PARALLELISM', '3'],
  ['PASSWORD_ARGON2_ITERATIONS', '3.0'],
  ['PASSWORD_ARGON2_MEMORY_KIB', ' 65536'],
])('rejects invalid %s=%s at module load', async (key, value) => {
  vi.stubEnv(key, value);
  await expect(import('./password-hash.js')).rejects.toThrow(key);
});
