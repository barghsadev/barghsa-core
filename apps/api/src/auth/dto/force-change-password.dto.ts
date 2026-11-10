import { replacementPasswordSchema } from '@barghsa/shared/password-validation';
import { z } from 'zod';

/**
 * Zod schema for the force password change request body (T-02.01.04).
 *
 * Requires the password change token issued during login detection and
 * the new password that satisfies the same strength policy as registration.
 */
export const ForceChangePasswordSchema = z.strictObject({
  passwordChangeToken: z.string().min(1, { message: 'VALIDATION:INPUT:MISSING' }),
  newPassword: replacementPasswordSchema,
});

export type ForceChangePasswordInput = z.infer<typeof ForceChangePasswordSchema>;

/**
 * Successful force password change response.
 */
export interface ForceChangePasswordResponse {
  /** Success message for the frontend toast. */
  message: string;
}
