import { passwordSchema } from '@barghsa/shared/password-validation';
import {
  canonicalizeAuthenticationUsername,
  isAuthenticationUsername,
} from '@barghsa/shared/username-normalization';
import { z } from 'zod';

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
    .trim()
    .min(1, { message: 'VALIDATION:INPUT:MISSING' })
    .max(255)
    .transform(canonicalizeAuthenticationUsername)
    .refine(isAuthenticationUsername, { message: 'AUTH:REGISTER:INVALID_USERNAME' }),
  password: passwordSchema,
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
