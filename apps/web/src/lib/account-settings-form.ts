import { normalizeUsername } from '@barghsa/shared/validation';
import { settingsUuid } from './settings-form.js';

export type ContactType = 'email' | 'mobile';
export type AccountSettingsUser = {
  userId: string;
  username: string;
  email: string | null;
  mobile: string | null;
  emailVerified: boolean;
  mobileVerified: boolean;
};
export type UsernameValues = { newUsername: string; otp: string; previousOtp: string };
export type ContactValues = { contactValue: string; otp: string };
export const emptyUsername: UsernameValues = { newUsername: '', otp: '', previousOtp: '' };
export const emptyContact: ContactValues = { contactValue: '', otp: '' };
export type AccountChallenge = {
  challengeId: string;
  destination: string;
  previousDestination?: string;
};
export type AccountCommand = {
  family: 'username' | 'contact';
  stage: 'send' | 'verify';
  actor: string;
  destination: string;
  contactType?: ContactType;
  body: Record<string, string>;
};
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
export function accountDestination(raw: string, type?: ContactType): string | null {
  if (raw.length > 255) return null;
  const value = normalizeUsername(raw);
  if (!value || value.length > 255) return null;
  const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  const mobile = /^\+[1-9]\d{6,14}$/.test(value);
  return (type === 'email' ? email : type === 'mobile' ? mobile : email || mobile) ? value : null;
}
export function accountSettingsUser(value: unknown, actor: string): AccountSettingsUser | null {
  if (
    !object(value) ||
    value.userId !== actor ||
    typeof value.username !== 'string' ||
    !value.username ||
    !(value.email === null || typeof value.email === 'string') ||
    !(value.mobile === null || typeof value.mobile === 'string') ||
    typeof value.emailVerified !== 'boolean' ||
    typeof value.mobileVerified !== 'boolean'
  )
    return null;
  return {
    userId: actor,
    username: value.username,
    email: value.email,
    mobile: value.mobile,
    emailVerified: value.emailVerified,
    mobileVerified: value.mobileVerified,
  };
}
export function accountChallenge(
  value: unknown,
  command: AccountCommand,
  previousUsername: string
): AccountChallenge | null {
  if (
    !object(value) ||
    !settingsUuid(value.challengeId) ||
    value.destination !== command.destination
  )
    return null;
  if (command.family === 'username' && value.previousDestination !== previousUsername) return null;
  return {
    challengeId: value.challengeId,
    destination: command.destination,
    ...(command.family === 'username' ? { previousDestination: previousUsername } : {}),
  };
}
export function accountMessage(value: unknown): boolean {
  return object(value) && typeof value.message === 'string' && !!value.message.trim();
}
export function accountCommandConfirmed(
  command: AccountCommand,
  user: AccountSettingsUser
): boolean {
  if (user.userId !== command.actor || command.stage !== 'verify') return false;
  if (command.family === 'username') return user.username === command.destination;
  return command.contactType === 'email'
    ? user.email === command.destination && user.emailVerified
    : command.contactType === 'mobile' &&
        user.mobile === command.destination &&
        user.mobileVerified;
}
export function accountErrorCode(value: unknown): string | null {
  if (!object(value)) return null;
  return typeof value.error === 'string'
    ? value.error
    : object(value.error) && typeof value.error.code === 'string'
      ? value.error.code
      : null;
}
const otpRejections = new Set(['AUTH:OTP:INVALID', 'AUTH:OTP:EXPIRED', 'AUTH:OTP:MAX_ATTEMPTS']);
export function accountWriteDenied(status: number, value: unknown): boolean {
  const code = accountErrorCode(value);
  return (
    status === 403 ||
    (status === 401 &&
      [
        'AUTH:UNAUTHENTICATED',
        'AUTH:TOKEN_EXPIRED',
        'AUTH:TOKEN_INVALID',
        'AUTH:SESSION_REVOKED',
      ].includes(code ?? ''))
  );
}
export function accountWriteRejected(status: number, value: unknown): boolean {
  return (
    (status === 401 && otpRejections.has(accountErrorCode(value) ?? '')) ||
    [400, 404, 409, 429].includes(status)
  );
}
