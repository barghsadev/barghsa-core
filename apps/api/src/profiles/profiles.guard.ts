import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Logger,
} from '@nestjs/common'
import type { Request } from 'express'
import { ErrorCodes } from '@barghsa/shared/errors'
import type { AuthenticatedRequest } from '../session/session.guard.js'
import { ProfilesService } from './profiles.service.js'

/**
 * Profile verification guard (T-03.01.02).
 *
 * Blocks commercial order submission when the user's active profile
 * is not verified AND the system requires verification. Applied to
 * order submission endpoints (future) to enforce the policy:
 * `profile.verified || !adminRequiresVerification`.
 *
 * Safe when the user has no default profile (no default → no
 * verified profile → blocked if verification required).
 *
 * Usage:
 * ```ts
 * @UseGuards(SessionAuthGuard, ProfileVerifiedGuard)
 * @Post('submit')
 * async submitOrder(@Req() req: AuthenticatedRequest) { ... }
 * ```
 *
 * Must run AFTER SessionAuthGuard so `req.session` is populated.
 */
@Injectable()
export class ProfileVerifiedGuard implements CanActivate {
  private readonly logger = new Logger(ProfileVerifiedGuard.name)

  constructor(private readonly profilesService: ProfilesService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request: Request = context.switchToHttp().getRequest()
    const authRequest = request as AuthenticatedRequest

    // Must have an authenticated session
    if (!authRequest.session) {
      this.logger.warn('ProfileVerifiedGuard: no authenticated session found')
      throw new ForbiddenException({
        statusCode: 403,
        error: ErrorCodes.AUTHZ_PROFILE_NOT_VERIFIED.code,
      })
    }

    const userId = authRequest.session.userId
    const canOrder = await this.profilesService.canPlaceCommercialOrder(userId)

    if (!canOrder) {
      this.logger.debug(
        `ProfileVerifiedGuard: user ${userId} cannot place commercial order — profile not verified`,
      )
      throw new ForbiddenException({
        statusCode: 403,
        error: ErrorCodes.AUTHZ_PROFILE_NOT_VERIFIED.code,
      })
    }

    return true
  }
}