import { Module } from '@nestjs/common'
import { ProfilesController } from './profiles.controller.js'
import { OnboardingController } from './onboarding.controller.js'
import { ProfilesService } from './profiles.service.js'
import { LegalProfilesService } from './legal-profiles.service.js'
import { ProfileVerifiedGuard } from './profiles.guard.js'
import { SessionModule } from '../session/session.module.js'

@Module({
  imports: [SessionModule],
  controllers: [ProfilesController, OnboardingController],
  providers: [ProfilesService, LegalProfilesService, ProfileVerifiedGuard],
  exports: [ProfilesService, LegalProfilesService, ProfileVerifiedGuard],
})
export class ProfilesModule {}