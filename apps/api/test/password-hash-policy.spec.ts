import { hash, verify } from 'argon2';
import { expect, it } from 'vitest';
import { PASSWORD_HASH_OPTIONS } from '@barghsa/shared/password-hash';

const password = 'Synthetic password hashing fixture';

it('generates independent 16-byte salts and verifies only the correct password', async () => {
  const first = await hash(password, PASSWORD_HASH_OPTIONS);
  const second = await hash(password, PASSWORD_HASH_OPTIONS);
  const salt = (encoded: string) => Buffer.from(encoded.split('$')[4] ?? '', 'base64');

  expect(salt(first)).toHaveLength(16);
  expect(salt(second)).toHaveLength(16);
  expect(salt(first)).not.toEqual(salt(second));
  expect(await verify(first, password)).toBe(true);
  expect(await verify(first, 'Incorrect password hashing fixture')).toBe(false);
});

it('still verifies an older Argon2 hash whose parameters differ from the current policy', async () => {
  const legacy = await hash(password, {
    ...PASSWORD_HASH_OPTIONS,
    memoryCost: 64 * 1024,
    parallelism: 4,
  });

  expect(await verify(legacy, password)).toBe(true);
  expect(await verify(legacy, 'Incorrect password hashing fixture')).toBe(false);
});
