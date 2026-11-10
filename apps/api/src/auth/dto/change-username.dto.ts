import {
  canonicalizeAuthenticationUsername,
  isAuthenticationUsername,
} from '@barghsa/shared/username-normalization';
import { z } from 'zod';

/**
 * Validates a username (email or E.164 phone).
 */
const usernameSchema = z
  .string()
  .min(1, { message: 'AUTH:CHANGE_USERNAME:INVALID' })
  .max(255)
  .trim()
  .toLowerCase()
  .transform(canonicalizeAuthenticationUsername)
  .refine(isAuthenticationUsername, { message: 'AUTH:CHANGE_USERNAME:INVALID' });

/**
 * Zod schema for initiating a username change (sends OTP).
 */
export const ChangeUsernameSendOtpSchema = z.object({
  newUsername: usernameSchema,
});

export type ChangeUsernameSendOtpInput = z.infer<typeof ChangeUsernameSendOtpSchema>;

/**
 * Zod schema for completing a username change (verifies OTP).
 */
export const ChangeUsernameVerifySchema = z.object({
  newUsername: usernameSchema,
  previousOtp: z.string().regex(/^\d{6}$/, { message: 'VALIDATION:INPUT:INVALID' }),
  otpChallengeId: z.string().uuid({ message: 'VALIDATION:INPUT:INVALID' }),
  otp: z
    .string()
    .length(6, { message: 'VALIDATION:INPUT:INVALID' })
    .regex(/^\d{6}$/, { message: 'VALIDATION:INPUT:INVALID' }),
});

export type ChangeUsernameVerifyInput = z.infer<typeof ChangeUsernameVerifySchema>;

/**
 * Response from initiating a username change.
 */
export interface ChangeUsernameSendOtpResponse {
  challengeId: string;
  destination: string;
  previousDestination: string;
}

/**
 * Response from completing a username change.
 */
export interface ChangeUsernameVerifyResponse {
  message: string;
}
