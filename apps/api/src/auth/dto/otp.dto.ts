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
 * Successful OTP verification response during registration flow.
 * Includes user ID, session ID, CSRF token, and session expiry.
 */
export interface RegisterVerifyResponse {
  /** The newly created user's UUID. */
  userId: string
  /** Opaque session identifier (stored in HttpOnly cookie). */
  sessionId: string
  /** CSRF token bound to the session for state-changing requests. */
  csrfToken: string
  /** ISO 8601 timestamp of when the session expires. */
  expiresAt: string
}

/**
 * OTP resend request body.
 */
export const ResendOtpSchema = z.object({
  challengeId: z.string().uuid({ message: 'VALIDATION:INPUT:INVALID' }),
})

export type ResendOtpInput = z.infer<typeof ResendOtpSchema>