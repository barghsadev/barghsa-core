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
