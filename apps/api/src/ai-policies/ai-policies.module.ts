import { Module } from '@nestjs/common'
import { SessionModule } from '../session/index.js'
import { PoliciesController, PolicyGroupsController } from './ai-policies.controller.js'
import { AiPoliciesService } from './ai-policies.service.js'

/**
 * AI policy administration module (S-09.11, T-09.11.03).
 *
 * Owns the durable `ai_policies`, `ai_policy_groups`, and
 * `ai_policy_group_members` entities (admin CRUD + group membership).
 * Policies define the rules/guardrails enforced by AI agents (T-09.11.04);
 * the service persists and audits them while the controller validates the
 * per-kind `rules` document and enforces the `admin:ai:policies`
 * capability + step-up on mutations.
 */
@Module({
  imports: [SessionModule],
  controllers: [PoliciesController, PolicyGroupsController],
  providers: [AiPoliciesService],
  exports: [AiPoliciesService],
})
export class AiPoliciesModule {}