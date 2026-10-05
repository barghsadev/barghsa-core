import { expect, it } from 'vitest';
import { loginFormSchema } from './login-form-schemas.js';
import { emptyLogin } from './login-form.js';
import { normalizeRecoveryUsername, recoveryPasswordValid } from './password-recovery-form.js';
const schema = (stage: 'credentials' | 'change' | 'otp') =>
  loginFormSchema(
    stage,
    {
      username: 'username',
      password: 'password',
      newPassword: 'newPassword',
      confirmation: 'confirmation',
      otp: 'otp',
    },
    {
      username: (value) => !!normalizeRecoveryUsername(value).type,
      password: recoveryPasswordValid,
    }
  );
it('retains login credential compatibility without new-password strength rules', () => {
  const value = { ...emptyLogin, username: ' USER@example.test ', password: 'a' };
  expect(schema('credentials').parse(value)).toEqual(value);
  expect(schema('credentials').safeParse({ ...value, password: '' }).success).toBe(false);
});
it('enforces the actual required-password-change range and confirmation without transforming raw drafts', () => {
  for (const value of [
    'Short1A',
    'lowercase123',
    'UPPERCASE123',
    'NoNumbersHere',
    'Aa1' + 'x'.repeat(126),
  ])
    expect(
      schema('change').safeParse({ ...emptyLogin, newPassword: value, confirmation: value }).success
    ).toBe(false);
  const value = ' Raw synthetic input 12A ';
  const draft = { ...emptyLogin, newPassword: value, confirmation: value };
  expect(schema('change').parse(draft)).toEqual(draft);
  expect(schema('change').safeParse({ ...draft, confirmation: value.trim() }).success).toBe(false);
  expect(
    schema('change').safeParse({
      ...emptyLogin,
      newPassword: 'Aa1' + 'x'.repeat(125),
      confirmation: 'Aa1' + 'x'.repeat(125),
    }).success
  ).toBe(true);
});
it('validates only the current OTP stage and requires six ASCII digits', () => {
  expect(schema('otp').safeParse({ ...emptyLogin, otp: '123456' }).success).toBe(true);
  for (const otp of ['123', '۱۲۳۴۵۶', 'abcdef'])
    expect(schema('otp').safeParse({ ...emptyLogin, otp }).success).toBe(false);
});
