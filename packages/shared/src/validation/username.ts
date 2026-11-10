import { z } from 'zod';
import { E164_PATTERN, isE164, normalizeUsername } from './normalize-username.js';

export { isE164 } from './normalize-username.js';

const emailSchema = z.email();
export const usernameSchema = z.union([emailSchema, z.string().regex(E164_PATTERN)]);

export function isEmail(value: string): boolean {
  return emailSchema.safeParse(value).success;
}

export function parseUsername(raw: string): { type: 'email' | 'mobile'; value: string } | null {
  const value = normalizeUsername(raw);
  if (value === null) return null;
  if (isE164(value)) return { type: 'mobile', value };
  return isEmail(value) ? { type: 'email', value } : null;
}
