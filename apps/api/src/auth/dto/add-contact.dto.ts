import { z } from 'zod'

/**
 * Zod schema for initiating an add-contact flow (send OTP to new contact).
 */
export const AddContactSendOtpSchema = z.object({
  contactType: z.enum(['email', 'mobile'], { message: 'VALIDATION:INPUT:INVALID' }),
  contactValue: z
    .string()
    .min(1, { message: 'VALIDATION:INPUT:MISSING' })
    .max(255),
})

export type AddContactSendOtpInput = z.infer<typeof AddContactSendOtpSchema>

/**
 * Zod schema for completing the add-contact flow (verify OTP).
 */
export const AddContactVerifySchema = z.object({
  contactType: z.enum(['email', 'mobile'], { message: 'VALIDATION:INPUT:INVALID' }),
  contactValue: z
    .string()
    .min(1, { message: 'VALIDATION:INPUT:MISSING' })
    .max(255),
  otpChallengeId: z.string().uuid({ message: 'VALIDATION:INPUT:INVALID' }),
  otp: z
    .string()
    .length(6, { message: 'VALIDATION:INPUT:INVALID' })
    .regex(/^\d{6}$/, { message: 'VALIDATION:INPUT:INVALID' }),
})

export type AddContactVerifyInput = z.infer<typeof AddContactVerifySchema>

/**
 * Response from initiating an add-contact flow.
 */
export interface AddContactSendOtpResponse {
  challengeId: string
  destination: string
}

/**
 * Response from completing an add-contact flow.
 */
export interface AddContactVerifyResponse {
  message: string
}