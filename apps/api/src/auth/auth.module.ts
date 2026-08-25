import { Module } from '@nestjs/common'
import { AuthController } from './auth.controller.js'
import { AuthService } from './auth.service.js'
import { OtpService } from './otp.service.js'
import { SessionModule } from '../session/session.module.js'
import { TosModule } from '../tos/tos.module.js'

@Module({
  imports: [SessionModule, TosModule],
  controllers: [AuthController],
  providers: [AuthService, OtpService],
  exports: [AuthService, OtpService],
})
export class AuthModule {}
