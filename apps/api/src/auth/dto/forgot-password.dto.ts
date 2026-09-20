import { z } from 'zod';

/**
 * Zod schema for the forgot-password request body.
 *
 * - Accepts email, Iranian mobile (09...), or international E.164 (+...).
 * - Normalizes Iranian mobile to E.164 on the backend.
 * - Response is always generic to avoid user enumeration.
 */
export const ForgotPasswordSchema = z.object({
  username: z
    .string()
    .min(1, { message: 'VALIDATION:INPUT:MISSING' })
    .max(255)
    .transform((value) => {
      const normalized = value.trim().toLowerCase();
      return /^09\d{9}$/.test(normalized) ? `+98${normalized.slice(1)}` : normalized;
    })
    .refine((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) || /^\+[1-9]\d{6,14}$/.test(value)),
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
