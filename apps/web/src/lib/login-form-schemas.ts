import { z } from 'zod/mini';
import type { LoginStage, LoginValues } from './login-form.js';
export const inactiveLoginSchema = z.custom<LoginValues>();
export function loginFormSchema(
  stage: LoginStage,
  messages: {
    username: string;
    password: string;
    newPassword: string;
    confirmation: string;
    otp: string;
  },
  valid: { username: (value: string) => boolean; password: (value: string) => boolean }
) {
  return z.custom<LoginValues>().check((ctx) => {
    const values = ctx.value;
    const issue = (field: keyof typeof messages) =>
      ctx.issues.push({
        code: 'custom',
        input: values?.[field],
        path: [field],
        message: messages[field],
      });
    if (stage === 'credentials') {
      if (
        typeof values?.username !== 'string' ||
        values.username.length > 255 ||
        !valid.username(values.username)
      )
        issue('username');
      // Existing credentials may predate today's new-password policy.
      if (typeof values?.password !== 'string' || !values.password.length) issue('password');
    } else if (stage === 'change') {
      if (typeof values?.newPassword !== 'string' || !valid.password(values.newPassword))
        issue('newPassword');
      if (
        typeof values?.confirmation !== 'string' ||
        !values.confirmation.length ||
        values.confirmation !== values.newPassword
      )
        issue('confirmation');
    } else if (typeof values?.otp !== 'string' || !/^\d{6}$/.test(values.otp)) issue('otp');
  });
}
