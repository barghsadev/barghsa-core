import { z } from 'zod'

/**
 * Validates an Iranian mobile (0912...) and converts to E.164 (+98912...).
 */
const IRANIAN_MOBILE_RE = /^09\d{9}$/

function toE164(value: string): string {
  if (IRANIAN_MOBILE_RE.test(value)) {
    return `+98${value.slice(1)}`
  }
  return value
}

/**
 * Zod schema for the login request body.
 *
 * - Accepts email, Iranian mobile (09...), or international E.164 (+...).
 * - Normalizes Iranian mobile to E.164 on the backend (same as RegisterSchema).
 * - Password is required (no strength re-validation — already enforced at registration).
 * - Device info is optional, for future risk-based OTP enforcement.
 */
export const LoginSchema = z.object({
  username: z
    .string()
    .min(1, { message: 'VALIDATION:INPUT:MISSING' })
    .max(255)
    .transform(toE164)
    .refine(
      (val) => {
        // Must be a valid email or E.164 phone number
        const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
        const e164Re = /^\+[1-9]\d{6,14}$/
        return emailRe.test(val) || e164Re.test(val)
      },
      { message: 'VALIDATION:INPUT:INVALID' },
    ),
  password: z.string().min(1, { message: 'VALIDATION:INPUT:MISSING' }),
  deviceInfo: z
    .object({
      userAgent: z.string().max(512).optional(),
      fingerprint: z.string().max(256).optional(),
    })
    .optional(),
})

export type LoginInput = z.infer<typeof LoginSchema>

export interface DeviceInfoInput {
  userAgent?: string
  fingerprint?: string
}

/**
 * Successful login response.
 *
 * When `requiresOtp` is true (risk-based MFA), only `challengeId` is provided.
 * When false, session credentials are returned directly.
 */
export interface LoginResponse {
  /** Whether the login requires step-up OTP verification. */
  requiresOtp: boolean
  /** Opaque challenge ID for OTP step, present when requiresOtp is true. */
  challengeId?: string
  /** UUID of the authenticated user. */
  userId?: string
  /** Opaque session identifier (stored in HttpOnly cookie). */
  sessionId?: string
  /** CSRF token bound to the session. */
  csrfToken?: string
  /** ISO 8601 timestamp of session expiry. */
  expiresAt?: string
}
