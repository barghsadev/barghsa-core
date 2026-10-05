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
/** Regex: starts with 09, followed by exactly 9 digits (11 total) */
const IRANIAN_MOBILE_RE = /^09\d{9}$/;

/** Regex: basic email validation */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Regex: loose E.164 — starts with +, 7-15 digits */
const E164_RE = /^\+[1-9]\d{6,14}$/;

type UsernameType = 'email' | 'mobile' | 'international' | null;

interface NormalizationResult {
  type: UsernameType;
  normalized: string;
  formatted: string | null;
}

/**
 * Detect the type of the raw input and normalize it.
 * Returns { type, normalized, formatted }.
 * - type=null means invalid/unrecognised.
 * - formatted is the display-friendly version (e.g. "+98 912 123 4567").
 */
export function normalizeRecoveryUsername(raw: string): NormalizationResult {
  const trimmed = raw.trim();

  // Iranian mobile: 09121234567 → +989****4567
  if (IRANIAN_MOBILE_RE.test(trimmed)) {
    const e164 = `+98${trimmed.slice(1)}`;
    const groups = e164.match(/^(\+\d{2})(\d{3})(\d{3})(\d{4})$/);
    const formatted = groups ? `${groups[1]} ${groups[2]} ${groups[3]} ${groups[4]}` : e164;
    return { type: 'mobile', normalized: e164, formatted };
  }

  // International (already E.164)
  if (trimmed.startsWith('+')) {
    if (E164_RE.test(trimmed)) {
      return { type: 'international', normalized: trimmed, formatted: null };
    }
    return { type: null, normalized: trimmed, formatted: null };
  }

  // Email
  if (EMAIL_RE.test(trimmed)) {
    return { type: 'email', normalized: trimmed.toLowerCase(), formatted: null };
  }

  return { type: null, normalized: trimmed, formatted: null };
}

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
  return (
    value.length >= 8 &&
    value.length <= 128 &&
    /[a-z]/.test(value) &&
    /[A-Z]/.test(value) &&
    /\d/.test(value)
  );
}
