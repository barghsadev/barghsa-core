import { z } from 'zod';

/** OTP-first reset exchange and the legacy combined reset request (T-02.03.02). */
const ChallengeIdSchema = z.string().uuid({ message: 'VALIDATION:INPUT:INVALID' });
const OtpSchema = z
  .string()
  .length(6)
  .regex(/^\d{6}$/);
export const ResetPasswordStrengthSchema = z
  .string()
  .min(8, { message: 'AUTH:REGISTER:WEAK_PASSWORD' })
  .max(128, { message: 'AUTH:REGISTER:WEAK_PASSWORD' })
  .regex(/[A-Z]/, { message: 'AUTH:REGISTER:WEAK_PASSWORD' })
  .regex(/[a-z]/, { message: 'AUTH:REGISTER:WEAK_PASSWORD' })
  .regex(/[0-9]/, { message: 'AUTH:REGISTER:WEAK_PASSWORD' });

export const VerifyResetOtpSchema = z
  .object({ challengeId: ChallengeIdSchema, otp: OtpSchema })
  .strict();
export type VerifyResetOtpInput = z.infer<typeof VerifyResetOtpSchema>;
export interface VerifyResetOtpResponse {
  verified: true;
  challengeId: string;
  resetToken: string;
  expiresAt: string;
}

// Keep the original combined request valid during rollout. The staged UI uses
// only the high-entropy authorization returned after OTP consumption.
const ResetBaseSchema = z.object({
  challengeId: ChallengeIdSchema,
  newPassword: ResetPasswordStrengthSchema,
});
export const ResetPasswordSchema = z.union([
  ResetBaseSchema.extend({ otp: OtpSchema }).strict(),
  ResetBaseSchema.extend({ resetToken: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
]);

export type ResetPasswordInput = z.infer<typeof ResetPasswordSchema>;

/**
 * Successful password reset response.
 */
export interface ResetPasswordResponse {
  /** Success message for the frontend toast. */
  message: string;
}
