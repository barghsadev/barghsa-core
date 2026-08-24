import { z } from 'zod';

/**
 * Validates an Iranian mobile (0912...) and converts to E.164 (+98912...).
 */
const IRANIAN_MOBILE_RE = /^09\d{9}$/;

function toE164(value: string): string {
  if (IRANIAN_MOBILE_RE.test(value)) {
    return `+98${value.slice(1)}`;
  }
  return value;
}

/**
 * Zod schema for the registration request body.
 *
 * - Accepts email, Iranian mobile (09...), or international E.164 (+...).
 * - Normalizes Iranian mobile to E.164 on the backend.
 * - Validates password minimum requirements.
 */
export const RegisterSchema = z.object({
  username: z
    .string()
    .min(1, { message: 'VALIDATION:INPUT:MISSING' })
    .max(255)
    .transform(toE164)
    .refine(
      (val) => {
        // Must be a valid email or E.164 phone number
        const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        const e164Re = /^\+[1-9]\d{6,14}$/;
        return emailRe.test(val) || e164Re.test(val);
      },
      { message: 'AUTH:REGISTER:INVALID_USERNAME' },
    ),
  password: z
    .string()
    .min(8, { message: 'AUTH:REGISTER:WEAK_PASSWORD' })
    .regex(/[a-z]/, { message: 'AUTH:REGISTER:WEAK_PASSWORD' })
    .regex(/[A-Z]/, { message: 'AUTH:REGISTER:WEAK_PASSWORD' })
    .regex(/\d/, { message: 'AUTH:REGISTER:WEAK_PASSWORD' }),
  tosVersionId: z.string().min(1, { message: 'VALIDATION:INPUT:MISSING' }),
});

export type RegisterInput = z.infer<typeof RegisterSchema>;

/**
 * Successful registration response.
 */
export interface RegisterResponse {
  /** Opaque challenge ID for the OTP verification step. */
  challengeId: string;
}