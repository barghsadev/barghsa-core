export { AuthModule } from './auth.module.js';
export { AuthService } from './auth.service.js';
export { AuthController } from './auth.controller.js';
export { OtpService } from './otp.service.js';
export type { OtpChallengeResult } from './otp.service.js';
export { RegisterSchema, type RegisterInput, type RegisterResponse } from './dto/register.dto.js';
export { VerifyOtpSchema, ResendOtpSchema, type VerifyOtpInput, type RegisterVerifyResponse, type ResendOtpInput } from './dto/otp.dto.js';
export { LoginSchema, type LoginInput, type LoginResponse } from './dto/login.dto.js';
export type { ForceChangePasswordInput, ForceChangePasswordResponse } from './dto/force-change-password.dto.js';
export { ForceChangePasswordSchema } from './dto/force-change-password.dto.js';
export {
  LoginVerifySchema,
  type LoginVerifyInput,
  type LoginVerifyResponse,
  LoginResendSchema,
  type LoginResendInput,
} from './dto/login.dto.js';