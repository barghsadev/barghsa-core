import { z } from 'zod'

/**
 * Zod schema for OTP verification request body.
 */
export const VerifyOtpSchema = z.object({
  challengeId: z.string().uuid({ message: 'VALIDATION:INPUT:INVALID' }),
  otp: z
    .string()
    .length(6, { message: 'VALIDATION:INPUT:INVALID' })
    .regex(/^\d{6}$/, { message: 'VALIDATION:INPUT:INVALID' }),
})

export type VerifyOtpInput = z.infer<typeof VerifyOtpSchema>

/**
 * Successful OTP verification response.
 */
export interface VerifyOtpResponse {
  verified: true
  challengeId: string
}

/**
 * OTP resend request body.
 */
export const ResendOtpSchema = z.object({
  challengeId: z.string().uuid({ message: 'VALIDATION:INPUT:INVALID' }),
})

export type ResendOtpInput = z.infer<typeof ResendOtpSchema>