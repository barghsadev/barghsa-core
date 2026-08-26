import { Module } from '@nestjs/common'
import { ProfilesController } from './profiles.controller.js'
import { OnboardingController } from './onboarding.controller.js'
import { AgentsController } from './agents.controller.js'
import { InvitationsController } from './invitations.controller.js'
import { ProfilesService } from './profiles.service.js'
import { LegalProfilesService } from './legal-profiles.service.js'
import { AgentsService } from './agents.service.js'
import { ProfileVerifiedGuard } from './profiles.guard.js'
import { AgentRoleGuard } from './agent-role.guard.js'
import { SessionModule } from '../session/session.module.js'
import { NotificationsModule } from '../notifications/index.js'

@Module({
  imports: [SessionModule, NotificationsModule],
  controllers: [ProfilesController, OnboardingController, AgentsController, InvitationsController],
  providers: [ProfilesService, LegalProfilesService, AgentsService, ProfileVerifiedGuard, AgentRoleGuard],
  exports: [ProfilesService, LegalProfilesService, AgentsService, ProfileVerifiedGuard, AgentRoleGuard],
})
export class ProfilesModule {}