import { expect, it } from 'vitest';
import {
  registrationTerms,
  registrationChallenge,
  registrationPasswordValid,
} from './registration-form.js';
import { registrationFormSchema } from './registration-form-schemas.js';
import { normalizeRecoveryUsername } from './password-recovery-form.js';
const id = '00000000-0000-4000-8000-000000000001';
const messages = { username: 'username', password: 'password', tos: 'tos', otp: 'otp' };
const valid = {
  username: (value: string) => !!normalizeRecoveryUsername(value).type,
  password: registrationPasswordValid,
};
it('accepts only a complete published terms receipt', () => {
  const terms = {
    id,
    versionId: 'v1',
    content: 'Published terms',
    updatedAt: '2030-01-01T00:00:00Z',
    publishedAt: '2030-01-01T00:00:00Z',
  };
  expect(registrationTerms(terms)).toEqual(terms);
  for (const bad of [
    null,
    { ...terms, content: '' },
    { ...terms, publishedAt: 'bad' },
    { ...terms, id: 'wrong' },
    { id, content: 'Terms' },
  ])
    expect(registrationTerms(bad)).toBeNull();
});
it('requires the actual opaque challenge identifier before OTP navigation', () => {
  expect(registrationChallenge({ challengeId: id })).toBe(id);
  for (const bad of [
    null,
    { challengeId: 'challenge' },
    { challengeId: '  ' },
    { challengeId: 42 },
  ])
    expect(registrationChallenge(bad)).toBeNull();
});
it('preserves registration password policy without adopting the recovery maximum', () => {
  expect(registrationPasswordValid('weak')).toBe(false);
  expect(registrationPasswordValid(' Strong synthetic value 12A ')).toBe(true);
  expect(registrationPasswordValid('Aa1' + 'x'.repeat(200))).toBe(true);
});
it('validates the selected native stage without transforming raw fields', () => {
  const values = {
    username: ' Draft@Example.test ',
    password: ' Raw synthetic value 12A ',
    tos: true,
    otp: '',
  };
  expect(registrationFormSchema('register', messages, valid).parse(values)).toEqual(values);
  expect(
    registrationFormSchema('register', messages, valid).safeParse({ ...values, tos: false }).success
  ).toBe(false);
  expect(registrationFormSchema('verify', messages, valid).safeParse(values).success).toBe(false);
  expect(
    registrationFormSchema('verify', messages, valid).safeParse({
      ...values,
      username: '',
      password: '',
      tos: false,
      otp: '123456',
    }).success
  ).toBe(true);
});
