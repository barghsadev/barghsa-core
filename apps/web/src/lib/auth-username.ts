import {
  canonicalizeAuthenticationUsername,
  isAuthenticationUsername,
  isE164,
} from '@barghsa/shared/username-normalization';
import { normalizeProfileDigits } from './profile-digits.js';

type UsernameType = 'email' | 'mobile' | 'international' | null;

interface NormalizationResult {
  type: UsernameType;
  normalized: string;
  formatted: string | null;
}

/** Use the canonical destination for requests and format a local mobile for display. */
export function normalizeRecoveryUsername(raw: string): NormalizationResult {
  const trimmed = raw.trim();
  const input = trimmed.includes('@') ? trimmed : normalizeProfileDigits(trimmed);
  const normalized = canonicalizeAuthenticationUsername(input);
  if (!isAuthenticationUsername(normalized)) {
    return { type: null, normalized: trimmed, formatted: null };
  }
  if (!isE164(normalized)) return { type: 'email', normalized, formatted: null };
  if (input.startsWith('+'))
    return { type: 'international', normalized, formatted: input === trimmed ? null : normalized };

  const formatted = [
    normalized.slice(0, 3),
    normalized.slice(3, 6),
    normalized.slice(6, 9),
    normalized.slice(9),
  ].join(' ');
  return { type: 'mobile', normalized, formatted };
}
