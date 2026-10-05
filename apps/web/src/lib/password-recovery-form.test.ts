import { expect, it } from 'vitest';
import {
  normalizeRecoveryUsername,
  recoveryPasswordValid,
  recoveryChallenge,
  recoveryAuthorization,
  recoveryResetReceipt,
} from './password-recovery-form.js';
import { passwordRecoverySchema } from './password-recovery-form-schemas.js';
const valid = {
  username: (value: string) => !!normalizeRecoveryUsername(value).type,
  password: recoveryPasswordValid,
};
const id = '00000000-0000-4000-8000-000000000001';
const messages = {
  username: 'username',
  otp: 'otp',
  password: 'password',
  confirmation: 'confirmation',
};
it('retains the original Iranian, international and email normalization', () => {
  expect(normalizeRecoveryUsername(' Recovery@Example.test ').normalized).toBe(
    'recovery@example.test'
  );
  expect(normalizeRecoveryUsername('09121234567').normalized).toBe('+989121234567');
  expect(normalizeRecoveryUsername('+447700900123').normalized).toBe('+447700900123');
  expect(normalizeRecoveryUsername('not valid').type).toBeNull();
});
it('validates only the current stage while preserving raw drafts', () => {
  const values = { username: ' Recovery@Example.test ', otp: '', password: '', confirmation: '' };
  expect(passwordRecoverySchema('request', messages, valid).safeParse(values).success).toBe(true);
  expect(passwordRecoverySchema('verify', messages, valid).safeParse(values).success).toBe(false);
  const raw = ' Strong synthetic value 12A ';
  expect(
    passwordRecoverySchema('reset', messages, valid).parse({
      ...values,
      password: raw,
      confirmation: raw,
    }).password
  ).toBe(raw);
  expect(
    passwordRecoverySchema('reset', messages, valid).safeParse({
      ...values,
      password: raw,
      confirmation: 'different',
    }).success
  ).toBe(false);
});
it('requires the actual anti-enumeration challenge response and matching unexpired authorization', () => {
  expect(
    recoveryChallenge({
      challengeId: id,
      sent: true,
      message: 'If an account exists, a verification code has been queued.',
    })
  ).toBe(id);
  expect(recoveryChallenge({ challengeId: 'challenge', sent: true })).toBeNull();
  const body = {
    verified: true,
    challengeId: id,
    resetToken: 'a'.repeat(64),
    expiresAt: '2030-01-01T00:00:00Z',
  };
  expect(recoveryAuthorization(body, id, 0)).not.toBeNull();
  expect(recoveryAuthorization(body, 'other', 0)).toBeNull();
  expect(recoveryAuthorization(body, id, Date.parse(body.expiresAt))).toBeNull();
});
it('requires the complete reset acknowledgement before clearing secrets', () => {
  expect(
    recoveryResetReceipt({
      message: 'Your password has been reset. Please log in with your new password.',
    })
  ).toBe(true);
  expect(recoveryResetReceipt({ message: 'private error' })).toBe(false);
});
