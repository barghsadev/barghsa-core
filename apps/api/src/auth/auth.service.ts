import { HttpException, Injectable, Logger } from '@nestjs/common'
import { ErrorCodes } from '@barghsa/shared/errors'
import type { RegisterInput, RegisterResponse } from './dto/register.dto.js'
import { OtpService } from './otp.service.js'

/**
 * Service handling registration business logic.
 *
 * At this stage (T-01.02.01), the service validates the input, checks for
 * duplicate usernames (stub), creates an OTP challenge via OtpService,
 * and returns the challengeId so the client can proceed to OTP verification.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name)

  constructor(private readonly otpService: OtpService) {}

  /**
   * Attempt to register a new user.
   *
   * Returns a `challengeId` for the next step (OTP verification).
   */
  async register(
    input: RegisterInput,
    ip: string,
  ): Promise<RegisterResponse> {
    // ── Check username availability (stub until DB wiring) ──────────
    // TODO: Replace with real DB query when user table is created
    const usernameTaken = false
    if (usernameTaken) {
      throw new HttpException(
        {
          statusCode: ErrorCodes.AUTH_REGISTER_USERNAME_TAKEN.httpStatus,
          error: ErrorCodes.AUTH_REGISTER_USERNAME_TAKEN.code,
        },
        ErrorCodes.AUTH_REGISTER_USERNAME_TAKEN.httpStatus,
      )
    }

    // ── Validate TOS version (stub until E-04 TOS admin is implemented) ──
    const validTosVersions = new Set(['current'])
    if (!validTosVersions.has(input.tosVersionId)) {
      throw new HttpException(
        {
          statusCode: ErrorCodes.AUTH_REGISTER_TOS_NOT_ACCEPTED.httpStatus,
          error: ErrorCodes.AUTH_REGISTER_TOS_NOT_ACCEPTED.code,
        },
        ErrorCodes.AUTH_REGISTER_TOS_NOT_ACCEPTED.httpStatus,
      )
    }

    // ── Create OTP challenge ────────────────────────────────────────
    const { challengeId } = await this.otpService.createChallenge(
      input.username,
      ip,
    )

    return { challengeId }
  }
}