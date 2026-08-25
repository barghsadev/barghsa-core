import { z } from 'zod'

/**
 * Zod schema for the force password change request body (T-02.01.04).
 *
 * Requires the password change token issued during login detection and
 * the new password that satisfies the same strength policy as registration.
 */
export const ForceChangePasswordSchema = z.object({
  passwordChangeToken: z.string().min(1, { message: 'VALIDATION:INPUT:MISSING' }),
  newPassword: z
    .string()
    .min(8, { message: 'AUTH:REGISTER:WEAK_PASSWORD' })
    .max(128, { message: 'AUTH:REGISTER:WEAK_PASSWORD' })
    .regex(/[A-Z]/, { message: 'AUTH:REGISTER:WEAK_PASSWORD' })
    .regex(/[a-z]/, { message: 'AUTH:REGISTER:WEAK_PASSWORD' })
    .regex(/[0-9]/, { message: 'AUTH:REGISTER:WEAK_PASSWORD' }),
})

export type ForceChangePasswordInput = z.infer<typeof ForceChangePasswordSchema>

/**
 * Successful force password change response.
 */
export interface ForceChangePasswordResponse {
  /** Success message for the frontend toast. */
  message: string
}