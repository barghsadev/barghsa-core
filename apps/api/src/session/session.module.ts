import { Module } from '@nestjs/common'
import { SessionService } from './session.service.js'
import { SessionController } from './session.controller.js'

/**
 * Session module (T-02.02.01 / T-02.02.02).
 *
 * Provides the centralized SessionService for session creation,
 * validation, rotation, refresh token management, and revocation,
 * and exposes the SessionController for session listing and revocation
 * endpoints (T-02.02.02).
 */
@Module({
  controllers: [SessionController],
  providers: [SessionService],
  exports: [SessionService],
})
export class SessionModule {}