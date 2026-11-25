export const verificationSections = ['requirements', 'codes', 'rate-limits', 'providers'] as const;
export type VerificationSection = 'mode' | (typeof verificationSections)[number];

export function verificationProviderId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}
