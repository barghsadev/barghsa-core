import { z } from 'zod/mini';
import type { RecoveryStage, RecoveryValues } from './password-recovery-form.js';
export const inactivePasswordRecoverySchema = z.custom<RecoveryValues>();
export function passwordRecoverySchema(
  stage: RecoveryStage,
  messages: { username: string; otp: string; password: string; confirmation: string },
  valid: { username: (value: string) => boolean; password: (value: string) => boolean }
) {
  return z.custom<RecoveryValues>().check((ctx) => {
    const values = ctx.value;
    const issue = (field: keyof RecoveryValues) =>
      ctx.issues.push({
        code: 'custom',
        input: values?.[field],
        path: [field],
        message: messages[field],
      });
    if (stage === 'request') {
      if (
        typeof values?.username !== 'string' ||
        values.username.length > 255 ||
        !valid.username(values.username)
      )
        issue('username');
    } else if (stage === 'verify') {
      if (typeof values?.otp !== 'string' || !/^\d{6}$/.test(values.otp)) issue('otp');
    } else {
      if (typeof values?.password !== 'string' || !valid.password(values.password))
        issue('password');
      if (
        typeof values?.confirmation !== 'string' ||
        !values.confirmation ||
        values.confirmation !== values.password
      )
        issue('confirmation');
    }
  });
}
