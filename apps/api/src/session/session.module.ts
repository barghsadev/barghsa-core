import { Module } from '@nestjs/common'
import { SessionService } from './session.service.js'

/**
 * Session module (T-02.02.01).
 *
 * Provides the centralized SessionService for session creation,
 * validation, rotation, refresh token management, and revocation.
 */
@Module({
  providers: [SessionService],
  exports: [SessionService],
})
export class SessionModule {}