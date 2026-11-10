import {
  canonicalizeAuthenticationUsername,
  isAuthenticationUsername,
  isE164,
} from '@barghsa/shared/username-normalization';

type UsernameType = 'email' | 'mobile' | 'international' | null;

interface NormalizationResult {
  type: UsernameType;
  normalized: string;
  formatted: string | null;
}

/** Use the canonical destination for requests and format a local mobile for display. */
export function normalizeRecoveryUsername(raw: string): NormalizationResult {
  const trimmed = raw.trim();
  const normalized = canonicalizeAuthenticationUsername(trimmed);
  if (!isAuthenticationUsername(normalized)) {
    return { type: null, normalized: trimmed, formatted: null };
  }
  if (!isE164(normalized)) return { type: 'email', normalized, formatted: null };
  if (trimmed.startsWith('+')) return { type: 'international', normalized, formatted: null };

  const formatted = [
    normalized.slice(0, 3),
    normalized.slice(3, 6),
    normalized.slice(6, 9),
    normalized.slice(9),
  ].join(' ');
  return { type: 'mobile', normalized, formatted };
}
