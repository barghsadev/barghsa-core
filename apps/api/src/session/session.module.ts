import { Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { SessionService } from './session.service.js'
import { SessionController } from './session.controller.js'
import { CsrfGuard } from './csrf.guard.js'

/**
 * Session module (T-02.02.01 / T-02.02.02 / T-02.02.03).
 *
 * Provides the centralized SessionService for session creation,
 * validation, rotation, refresh token management, and revocation,
 * and exposes the SessionController for session listing and revocation
 * endpoints (T-02.02.02).
 *
 * Registers the CsrfGuard as a global guard (T-02.02.03) so every
 * state-changing request to any endpoint is validated for CSRF tokens
 * when an authenticated session is present.
 */
@Module({
  controllers: [SessionController],
  providers: [
    SessionService,
    {
      provide: APP_GUARD,
      useClass: CsrfGuard,
    },
  ],
  exports: [SessionService],
})
export class SessionModule {}