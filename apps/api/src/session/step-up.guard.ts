import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Logger,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { Request } from 'express'
import { ErrorCodes } from '@barghsa/shared/errors'
import type { AuthenticatedRequest } from './session.guard.js'
import { SessionService } from './session.service.js'

/** Step-up window constant (shared with SessionService). */
const STEP_UP_WINDOW_MS = SessionService.STEP_UP_WINDOW_MS

/**
 * Step-up authentication guard (T-02.02.04).
 *
 * Validates that the authenticated session has a recent step-up
 * verification (within the configured window, default 15 minutes).
 *
 * Sensitive actions (role changes, storage/payment credentials,
 * payment confirmation, refunds, contract cancellation, price changes,
 * session revocation, profile deletion, ownership transfer) must
 * apply this guard via the @RequiresStepUp() decorator.
 *
 * Design:
 * - Returns 403 with `requiresStepUp: true` and the error code
 *   `AUTHZ:STEP_UP_REQUIRED` when step-up is needed.
 * - The step-up window is checked against `session.stepUpVerifiedAt`.
 * - This guard runs AFTER SessionAuthGuard so `req.session` is populated.
 * - Frontend intercepts the `requiresStepUp` flag and shows a
 *   step-up dialog (password or OTP).
 *
 * Usage:
 * ```ts
 * @UseGuards(SessionAuthGuard, StepUpGuard)
 * @Post('change-role')
 * async changeRole(@Req() req: AuthenticatedRequest) { ... }
 * ```
 *
 * Or with the shorthand decorator:
 * ```ts
 * @RequiresStepUp()
 * @Post('change-role')
 * ```
 */
@Injectable()
export class StepUpGuard implements CanActivate {
  private readonly logger = new Logger(StepUpGuard.name)

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request: Request = context.switchToHttp().getRequest()
    const authRequest = request as AuthenticatedRequest

    // ── Check if step-up is required for this handler ──────────
    const isStepUpRequired =
      this.reflector.get<boolean>('requiresStepUp', context.getHandler()) ?? false

    if (!isStepUpRequired) {
      // No step-up required — allow
      return true
    }

    // ── Must have an authenticated session ─────────────────────
    if (!authRequest.session) {
      // SessionAuthGuard should have already rejected this,
      // but guard defensively.
      this.logger.warn('StepUpGuard: no authenticated session found')
      throw new ForbiddenException({
        statusCode: 403,
        error: ErrorCodes.AUTHZ_STEP_UP_REQUIRED.code,
      })
    }

    // ── Check step-up verification ──────────────────────────────
    const { stepUpVerifiedAt } = authRequest.session

    if (!stepUpVerifiedAt) {
      // Never performed step-up
      this.logger.debug(
        `Step-up required for session ${authRequest.session.sessionId}: never verified`,
      )
      throw new ForbiddenException({
        statusCode: 403,
        error: ErrorCodes.AUTHZ_STEP_UP_REQUIRED.code,
      })
    }

    const now = new Date()
    const elapsed = now.getTime() - stepUpVerifiedAt.getTime()

    if (elapsed > STEP_UP_WINDOW_MS) {
      // Step-up window has expired
      this.logger.debug(
        `Step-up required for session ${authRequest.session.sessionId}: ` +
          `last verified ${elapsed}ms ago (window: ${STEP_UP_WINDOW_MS}ms)`,
      )
      throw new ForbiddenException({
        statusCode: 403,
        error: ErrorCodes.AUTHZ_STEP_UP_REQUIRED.code,
      })
    }

    return true
  }
}

/**
 * Decorator to mark a route handler as requiring step-up authentication.
 *
 * Use on any controller method that performs sensitive actions
 * (role changes, storage/payment credentials, payment confirmation,
 * refunds, contract cancellation, price changes, session revocation,
 * profile deletion, ownership transfer).
 *
 * ```ts
 * @RequiresStepUp()
 * @Post('change-role')
 * async changeRole(@Req() req: AuthenticatedRequest) { ... }
 * ```
 *
 * The guard must be registered on the controller or method:
 * ```ts
 * @UseGuards(SessionAuthGuard, StepUpGuard)
 * // or globally via APP_GUARD
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function RequiresStepUp(): MethodDecorator {
  return (
    _target: object,
    _propertyKey: string | symbol,
    descriptor: TypedPropertyDescriptor<any>,
  ) => {
    Reflect.defineMetadata('requiresStepUp', true, descriptor.value!)
    return descriptor
  }
}
