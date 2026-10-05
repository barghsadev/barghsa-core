import { expect, it } from 'vitest';
import {
  accountDestination,
  accountSettingsUser,
  accountChallenge,
  accountMessage,
  accountCommandConfirmed,
  accountWriteDenied,
  accountWriteRejected,
  type AccountCommand,
} from './account-settings-form.js';
import { usernameSettingsSchema, contactSettingsSchema } from './account-settings-form-schemas.js';
const command: AccountCommand = {
  family: 'username',
  stage: 'send',
  actor: 'opaque-user',
  destination: 'new@example.test',
  body: { newUsername: 'new@example.test' },
};
const user = {
  userId: 'opaque-user',
  username: 'new@example.test',
  email: 'new@example.test',
  mobile: '+989120000001',
  emailVerified: true,
  mobileVerified: false,
};
it('normalizes supported destinations without accepting a different contact type or unsafe number', () => {
  expect(accountDestination('  NEW@example.test  ')).toBe('new@example.test');
  expect(accountDestination('09120000001', 'mobile')).toBe('+989120000001');
  expect(accountDestination('+0123456789')).toBeNull();
  expect(accountDestination('a@b.test', 'mobile')).toBeNull();
  expect(accountDestination('+989120000001', 'email')).toBeNull();
  expect(accountDestination('x'.repeat(256) + '@b.test')).toBeNull();
});
it('reads only the current actor and complete actual account projection', () => {
  expect(accountSettingsUser(user, 'opaque-user')).toEqual(user);
  expect(accountSettingsUser(user, 'other')).toBeNull();
  expect(accountSettingsUser({ ...user, mobileVerified: undefined }, 'opaque-user')).toBeNull();
  expect(accountSettingsUser({ ...user, email: {} }, 'opaque-user')).toBeNull();
  expect(accountSettingsUser({ ...user, private: 'secret' }, 'opaque-user')).not.toHaveProperty(
    'private'
  );
});
it('binds actual send receipts to the original destination and previous username', () => {
  const receipt = {
    challengeId: '10000000-0000-4000-8000-000000000001',
    destination: command.destination,
    previousDestination: 'old@example.test',
  };
  expect(accountChallenge(receipt, command, 'old@example.test')).toEqual(receipt);
  for (const changed of [
    { challengeId: 'not-uuid' },
    { destination: 'other@example.test' },
    { previousDestination: 'other@example.test' },
  ])
    expect(accountChallenge({ ...receipt, ...changed }, command, 'old@example.test')).toBeNull();
  expect(
    accountChallenge(receipt, { ...command, family: 'contact' }, 'old@example.test')
  ).not.toHaveProperty('previousDestination');
});
it('confirms only verification, matching actor and actual verified destination', () => {
  expect(accountCommandConfirmed(command, user)).toBe(false);
  expect(accountCommandConfirmed({ ...command, stage: 'verify' }, user)).toBe(true);
  expect(accountCommandConfirmed({ ...command, stage: 'verify', actor: 'other' }, user)).toBe(
    false
  );
  const contact: AccountCommand = {
    ...command,
    stage: 'verify',
    family: 'contact',
    contactType: 'mobile',
    destination: user.mobile,
  };
  expect(accountCommandConfirmed(contact, user)).toBe(false);
  expect(accountCommandConfirmed(contact, { ...user, mobileVerified: true })).toBe(true);
  expect(
    accountCommandConfirmed(contact, { ...user, mobileVerified: true, mobile: '+989120000002' })
  ).toBe(false);
});
it('requires the actual message receipt without exposing its text', () => {
  expect(accountMessage({ message: 'verified', private: 'secret' })).toBe(true);
  for (const value of [null, {}, { message: '' }, { message: 42 }])
    expect(accountMessage(value)).toBe(false);
});
it('distinguishes known OTP rejections from lost authority and unknown 401 bodies', () => {
  for (const code of ['AUTH:OTP:INVALID', 'AUTH:OTP:EXPIRED', 'AUTH:OTP:MAX_ATTEMPTS']) {
    expect(accountWriteDenied(401, { error: code })).toBe(false);
    expect(accountWriteRejected(401, { error: { code } })).toBe(true);
  }
  expect(accountWriteDenied(401, { error: { code: 'AUTH:SESSION_REVOKED' } })).toBe(true);
  expect(accountWriteDenied(401, {})).toBe(false);
  expect(accountWriteRejected(401, {})).toBe(false);
  expect(accountWriteRejected(503, {})).toBe(false);
});
it('validates the native stage while preserving raw username and both code strings', () => {
  const raw = { newUsername: '  NEW@example.test  ', otp: '', previousOtp: '' };
  expect(usernameSettingsSchema((x) => x, false).parse(raw)).toEqual(raw);
  const verify = usernameSettingsSchema((x) => x, true);
  expect(verify.safeParse({ ...raw, otp: '123456', previousOtp: 'abcdef' }).success).toBe(false);
  expect(verify.parse({ ...raw, otp: '123456', previousOtp: '654321' }).newUsername).toBe(
    raw.newUsername
  );
});
it('validates contact type and exact six digits without rewriting the raw draft', () => {
  const raw = { contactValue: ' 09120000001 ', otp: '' };
  expect(contactSettingsSchema((x) => x, false, 'mobile').parse(raw)).toEqual(raw);
  expect(contactSettingsSchema((x) => x, false, 'email').safeParse(raw).success).toBe(false);
  expect(
    contactSettingsSchema((x) => x, true, 'mobile').safeParse({ ...raw, otp: '12345x' }).success
  ).toBe(false);
  expect(contactSettingsSchema((x) => x, true, null).safeParse(raw).success).toBe(false);
});
