import { z } from 'zod'

/**
 * Zod schema for the password reset request body (T-02.03.02).
 *
 * After OTP verification, the user provides:
 * - `challengeId` — the OTP challenge UUID from the forgot-password flow
 * - `otp` — the 6-digit code sent to the user's registered destination
 * - `newPassword` — the new password satisfying the same strength policy
 */
export const ResetPasswordSchema = z.object({
  challengeId: z.string().uuid({ message: 'VALIDATION:INPUT:INVALID' }),
  otp: z
    .string()
    .length(6, { message: 'VALIDATION:INPUT:INVALID' })
    .regex(/^\d{6}$/, { message: 'VALIDATION:INPUT:INVALID' }),
  newPassword: z
    .string()
    .min(8, { message: 'AUTH:REGISTER:WEAK_PASSWORD' })
    .max(128, { message: 'AUTH:REGISTER:WEAK_PASSWORD' })
    .regex(/[A-Z]/, { message: 'AUTH:REGISTER:WEAK_PASSWORD' })
    .regex(/[a-z]/, { message: 'AUTH:REGISTER:WEAK_PASSWORD' })
    .regex(/[0-9]/, { message: 'AUTH:REGISTER:WEAK_PASSWORD' }),
})

export type ResetPasswordInput = z.infer<typeof ResetPasswordSchema>

/**
 * Successful password reset response.
 */
export interface ResetPasswordResponse {
  /** Success message for the frontend toast. */
  message: string
}