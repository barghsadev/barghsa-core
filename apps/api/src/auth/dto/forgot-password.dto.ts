import {
  canonicalizeAuthenticationUsername,
  isAuthenticationUsername,
} from '@barghsa/shared/username-normalization';
import { z } from 'zod';

/**
 * Zod schema for the forgot-password request body.
 *
 * - Accepts email, Iranian mobile (09...), or international E.164 (+...).
 * - Normalizes Iranian mobile to E.164 on the backend.
 * - Response is always generic to avoid user enumeration.
 */
export const ForgotPasswordSchema = z.strictObject({
  username: z
    .string()
    .min(1, { message: 'VALIDATION:INPUT:MISSING' })
    .max(255)
    .transform(canonicalizeAuthenticationUsername)
    .refine(isAuthenticationUsername),
});

export type ForgotPasswordInput = z.infer<typeof ForgotPasswordSchema>;

/** sent is always true — this field is for forward compatibility only */
export interface ForgotPasswordResponse {
  /** Opaque identifier, including for unknown accounts. */
  challengeId: string;
  /** Always true — HTTP 200 is the real signal. */
  sent: true;
  /** Generic message shown to the user. */
  message: string;
}
