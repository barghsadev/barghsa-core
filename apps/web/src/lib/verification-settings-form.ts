import { ErrorCodes } from '@barghsa/shared/errors';
export const verificationModes = ['DISABLED', 'MANUAL', 'API'] as const;
export type VerificationMode = (typeof verificationModes)[number];
export type VerificationConfig = {
  mode: VerificationMode;
  draft: VerificationMode | null;
  version: number;
};
export type VerificationDraft = { mode: VerificationMode };
export type OtpConfig = { ttlSeconds: number; version: number };
export type OtpDraft = { ttlSeconds: string };
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const version = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const mode = (value: unknown): value is VerificationMode =>
  verificationModes.some((mode) => mode === value);
export function validVerificationConfig(value: unknown): value is VerificationConfig {
  return (
    record(value) &&
    mode(value.mode) &&
    (value.draft === null || mode(value.draft)) &&
    version(value.version)
  );
}
export function validOtpConfig(value: unknown): value is OtpConfig {
  return (
    record(value) &&
    typeof value.ttlSeconds === 'number' &&
    Number.isInteger(value.ttlSeconds) &&
    value.ttlSeconds >= 60 &&
    value.ttlSeconds <= 900 &&
    version(value.version)
  );
}
export const verificationBasis = (value: VerificationConfig) =>
  JSON.stringify([value.mode, value.draft, value.version]);
export const otpBasis = (value: OtpConfig) => JSON.stringify([value.ttlSeconds, value.version]);
export const invalidVerificationFields = (draft: VerificationDraft): (keyof VerificationDraft)[] =>
  draft.mode === 'DISABLED' || draft.mode === 'MANUAL' ? [] : ['mode'];
export function invalidOtpFields(draft: OtpDraft): (keyof OtpDraft)[] {
  const seconds = Number(draft.ttlSeconds);
  return draft.ttlSeconds.trim() && Number.isSafeInteger(seconds) && seconds >= 60 && seconds <= 900
    ? []
    : ['ttlSeconds'];
}

export function settingsErrorFields(value: unknown): unknown[] {
  return record(value) &&
    record(value.error) &&
    value.error.code === ErrorCodes.VALIDATION_INPUT_INVALID.code &&
    Array.isArray(value.error.fields)
    ? value.error.fields
    : [];
}
