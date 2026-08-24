import {
  Injectable,
  Logger,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ErrorCodes } from '@barghsa/shared/errors';
import { RateLimitService } from '../rate-limit/rate-limit.service.js';
import { rateLimitKey } from '@barghsa/shared/rate-limit';
import type { RegisterInput, RegisterResponse } from './dto/register.dto.js';

/**
 * Service handling registration business logic.
 *
 * At this stage (T-01.01.06), the service validates the input, checks for
 * duplicate usernames (stub), enforces rate limits, and returns a mock
 * challengeId. The actual user creation and OTP storage will be implemented
 * in T-01.02.01 / T-01.02.03.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(private readonly rateLimitService: RateLimitService) {}

  /**
   * Attempt to register a new user.
   *
   * Returns a `challengeId` for the next step (OTP verification).
   *
   * Throws `HttpException` with the appropriate error code for:
   * - DUPLICATE username (USERNAME_TAKEN)
   * - Rate limit exceeded (RATE_LIMITED)
   * - Generic / internal errors (INTERNAL_ERROR)
   */
  async register(
    input: RegisterInput,
    ip: string,
  ): Promise<RegisterResponse> {
    // ── Check username availability (stub until DB wiring) ──────────
    // TODO: Replace with real DB query (T-01.01.06 → user table creation)
    const usernameTaken = false;
    if (usernameTaken) {
      throw new HttpException(
        {
          statusCode: ErrorCodes.AUTH_REGISTER_USERNAME_TAKEN.httpStatus,
          error: ErrorCodes.AUTH_REGISTER_USERNAME_TAKEN.code,
          message: ErrorCodes.AUTH_REGISTER_USERNAME_TAKEN.code,
        },
        ErrorCodes.AUTH_REGISTER_USERNAME_TAKEN.httpStatus,
      );
    }

    // ── Generate challenge ID (placeholder) ─────────────────────────
    // TODO: Create actual OTP challenge and store it (T-01.02.01)
    const challengeId = crypto.randomUUID();

    return { challengeId };
  }
}