import { Module } from '@nestjs/common'
import { SessionModule } from '../session/index.js'
import { AgentsController } from './ai-agents.controller.js'
import { AiAgentsService } from './ai-agents.service.js'

/**
 * AI agent administration module (S-09.11, T-09.11.04) — slice 1.
 *
 * Owns the durable `ai_agents` entity (admin CRUD) and the KB/policy link
 * orchestration. An agent references exactly one AI model (T-09.11.01) and
 * optionally links knowledge bases (T-09.11.02) and usage policies
 * (T-09.11.03). Slot assignment (T-09.11.05) and the test-chat widget are
 * later slices of the same task.
 */
@Module({
  imports: [SessionModule],
  controllers: [AgentsController],
  providers: [AiAgentsService],
  exports: [AiAgentsService],
})
export class AiAgentsModule {}
