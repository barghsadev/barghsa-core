import { z } from 'zod/mini';
import {
  accountDestination,
  type ContactType,
  type ContactValues,
  type UsernameValues,
} from './account-settings-form.js';
type Copy = (key: string) => string;
const issue = (path: string, message: string, input: unknown) => ({
  code: 'custom' as const,
  path: [path],
  message,
  input,
});
export const inactiveAccountSettingsSchema = z.custom<never>().check((ctx) => {
  ctx.issues.push(issue('root', '', ctx.value));
});
export function usernameSettingsSchema(copy: Copy, verify: boolean) {
  return z.custom<UsernameValues>().check((ctx) => {
    const raw = ctx.value;
    if (
      !raw ||
      typeof raw.newUsername !== 'string' ||
      typeof raw.otp !== 'string' ||
      typeof raw.previousOtp !== 'string'
    ) {
      ctx.issues.push(issue('root', copy('validationUnavailable'), raw));
      return;
    }
    if (!verify && !accountDestination(raw.newUsername))
      ctx.issues.push(issue('newUsername', copy('usernameInvalid'), raw.newUsername));
    if (verify)
      for (const key of ['previousOtp', 'otp'] as const)
        if (!/^\d{6}$/.test(raw[key])) ctx.issues.push(issue(key, copy('otpInvalid'), raw[key]));
  });
}
export function contactSettingsSchema(copy: Copy, verify: boolean, type: ContactType | null) {
  return z.custom<ContactValues>().check((ctx) => {
    const raw = ctx.value;
    if (!raw || typeof raw.contactValue !== 'string' || typeof raw.otp !== 'string' || !type) {
      ctx.issues.push(issue('root', copy('validationUnavailable'), raw));
      return;
    }
    if (!verify && !accountDestination(raw.contactValue, type))
      ctx.issues.push(
        issue(
          'contactValue',
          copy(type === 'email' ? 'emailInvalid' : 'mobileInvalid'),
          raw.contactValue
        )
      );
    if (verify && !/^\d{6}$/.test(raw.otp))
      ctx.issues.push(issue('otp', copy('otpInvalid'), raw.otp));
  });
}
