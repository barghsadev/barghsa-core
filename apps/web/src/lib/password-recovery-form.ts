import { meetsReplacementPasswordPolicy } from '@barghsa/shared/password-policy';
import { authResponseRecord } from './auth-responses.js';
export type RecoveryStage = 'request' | 'verify' | 'reset';
export type RecoveryValues = {
  username: string;
  otp: string;
  password: string;
  confirmation: string;
};
export const emptyRecovery: RecoveryValues = {
  username: '',
  otp: '',
  password: '',
  confirmation: '',
};
export { normalizeRecoveryUsername } from './auth-username.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function recoveryChallenge(value: unknown): string | null {
  const body = authResponseRecord(value);
  return typeof body?.challengeId === 'string' &&
    uuid.test(body.challengeId) &&
    body.sent === true &&
    body.message === 'If an account exists, a verification code has been queued.'
    ? body.challengeId
    : null;
}
export function recoveryAuthorization(
  value: unknown,
  challengeId: string,
  now = Date.now()
): { token: string; expiresAt: number } | null {
  const body = authResponseRecord(value);
  const expiresAt = typeof body?.expiresAt === 'string' ? Date.parse(body.expiresAt) : NaN;
  return body?.verified === true &&
    body.challengeId === challengeId &&
    typeof body.resetToken === 'string' &&
    /^[a-f0-9]{64}$/.test(body.resetToken) &&
    Number.isFinite(expiresAt) &&
    expiresAt > now
    ? { token: body.resetToken, expiresAt }
    : null;
}
export function recoveryResetReceipt(value: unknown): boolean {
  return (
    authResponseRecord(value)?.message ===
    'Your password has been reset. Please log in with your new password.'
  );
}
export function recoveryPasswordValid(value: string): boolean {
  return meetsReplacementPasswordPolicy(value);
}
