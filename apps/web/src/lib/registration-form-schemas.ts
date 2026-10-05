import { z } from 'zod/mini';
import type { RegistrationValues } from './registration-form.js';
export const inactiveRegistrationSchema = z.custom<RegistrationValues>();
export function registrationFormSchema(
  stage: 'register' | 'verify',
  messages: { username: string; password: string; tos: string; otp: string },
  valid: { username: (value: string) => boolean; password: (value: string) => boolean }
) {
  return z.custom<RegistrationValues>().check((ctx) => {
    const values = ctx.value;
    const issue = (field: keyof RegistrationValues) =>
      ctx.issues.push({
        code: 'custom',
        input: values?.[field],
        path: [field],
        message: messages[field],
      });
    if (stage === 'verify') {
      if (typeof values?.otp !== 'string' || !/^\d{6}$/.test(values.otp)) issue('otp');
    } else {
      if (
        typeof values?.username !== 'string' ||
        values.username.length > 255 ||
        !valid.username(values.username)
      )
        issue('username');
      if (typeof values?.password !== 'string' || !valid.password(values.password))
        issue('password');
      if (values?.tos !== true) issue('tos');
    }
  });
}
