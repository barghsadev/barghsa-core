import { Module } from '@nestjs/common'
import { ProfilesController } from './profiles.controller.js'
import { ProfilesService } from './profiles.service.js'
import { ProfileVerifiedGuard } from './profiles.guard.js'
import { SessionModule } from '../session/session.module.js'

@Module({
  imports: [SessionModule],
  controllers: [ProfilesController],
  providers: [ProfilesService, ProfileVerifiedGuard],
  exports: [ProfilesService, ProfileVerifiedGuard],
})
export class ProfilesModule {}