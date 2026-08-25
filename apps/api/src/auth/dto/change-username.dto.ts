import { z } from 'zod'

/**
 * Normalizes Iranian mobile numbers to E.164 format.
 */
const IRANIAN_MOBILE_RE = /^09\d{9}$/

function toE164(value: string): string {
  if (IRANIAN_MOBILE_RE.test(value)) {
    return `+98${value.slice(1)}`
  }
  return value
}

/**
 * Validates a username (email or E.164 phone).
 */
const usernameSchema = z
  .string()
  .min(1, { message: 'AUTH:CHANGE_USERNAME:INVALID' })
  .max(255)
  .transform(toE164)
  .refine(
    (val) => {
      const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      const e164Re = /^\+[1-9]\d{6,14}$/
      return emailRe.test(val) || e164Re.test(val)
    },
    { message: 'AUTH:CHANGE_USERNAME:INVALID' },
  )

/**
 * Zod schema for initiating a username change (sends OTP).
 */
export const ChangeUsernameSendOtpSchema = z.object({
  newUsername: usernameSchema,
})

export type ChangeUsernameSendOtpInput = z.infer<typeof ChangeUsernameSendOtpSchema>

/**
 * Zod schema for completing a username change (verifies OTP).
 */
export const ChangeUsernameVerifySchema = z.object({
  newUsername: usernameSchema,
  otpChallengeId: z.string().uuid({ message: 'VALIDATION:INPUT:INVALID' }),
  otp: z
    .string()
    .length(6, { message: 'VALIDATION:INPUT:INVALID' })
    .regex(/^\d{6}$/, { message: 'VALIDATION:INPUT:INVALID' }),
})

export type ChangeUsernameVerifyInput = z.infer<typeof ChangeUsernameVerifySchema>

/**
 * Response from initiating a username change.
 */
export interface ChangeUsernameSendOtpResponse {
  challengeId: string
  destination: string
}

/**
 * Response from completing a username change.
 */
export interface ChangeUsernameVerifyResponse {
  message: string
}