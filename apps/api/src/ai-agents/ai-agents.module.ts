import { Module } from '@nestjs/common'
import { SessionModule } from '../session/index.js'
import { AgentsController } from './ai-agents.controller.js'
import { AiAgentsService } from './ai-agents.service.js'
import { AgentSlotsController } from './ai-agent-slots.controller.js'
import { AgentSlotsService } from './ai-agent-slots.service.js'

/**
 * AI agent administration module (S-09.11, T-09.11.04 + T-09.11.05).
 *
 * Owns the durable `ai_agents` entity (admin CRUD) and the KB/policy link
 * orchestration. An agent references exactly one AI model (T-09.11.01) and
 * optionally links knowledge bases (T-09.11.02) and usage policies
 * (T-09.11.03). Slot assignment (T-09.11.05) maps the predefined chatbot
 * slots to agents. The test-chat widget and the admin web UI are later
 * slices of the same epic.
 */
@Module({
  imports: [SessionModule],
  controllers: [AgentsController, AgentSlotsController],
  providers: [AiAgentsService, AgentSlotsService],
  exports: [AiAgentsService, AgentSlotsService],
})
export class AiAgentsModule {}
