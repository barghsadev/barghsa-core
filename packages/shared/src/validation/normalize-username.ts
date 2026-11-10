const localMobile = /^09\d{9}$/;
const internationalIranian = /^(?:00)?(98\d{10})$/;
const legacyEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const E164_PATTERN = /^\+[1-9]\d{6,14}$/;

export function isE164(value: string): boolean {
  return E164_PATTERN.test(value);
}

/** Preserve the public auth boundary's national mobile input and stored email compatibility. */
export function canonicalizeAuthenticationUsername(raw: string): string {
  const value = raw.trim().toLowerCase();
  return localMobile.test(value) ? '+98' + value.slice(1) : value;
}

export function isAuthenticationUsername(value: string): boolean {
  return isE164(value) || legacyEmail.test(value);
}

/** Normalize email, national mobile and the additional Iranian dial-prefix aliases. */
export function normalizeUsername(raw: string): string | null {
  const value = raw.trim();
  const alias = internationalIranian.exec(value);
  const canonical = canonicalizeAuthenticationUsername(alias ? '+' + alias[1] : value);
  return isAuthenticationUsername(canonical) ? canonical : null;
}
