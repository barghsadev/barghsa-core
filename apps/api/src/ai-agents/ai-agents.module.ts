import { Module } from '@nestjs/common';
import { SessionModule } from '../session/index.js';
import { AgentsController } from './ai-agents.controller.js';
import { AiAgentsService } from './ai-agents.service.js';
import { AgentSlotsController } from './ai-agent-slots.controller.js';
import { AgentSlotsService } from './ai-agent-slots.service.js';
import { AiModelsModule } from '../ai-models/ai-models.module.js';
import { AiTestChatController } from './ai-test-chat.controller.js';
import { AiTestChatService } from './ai-test-chat.service.js';
import { ProfilesModule } from '../profiles/profiles.module.js';
import { AiKnowledgeChatController } from './ai-knowledge-chat.controller.js';
import { AiKnowledgeChatService } from './ai-knowledge-chat.service.js';
import { AiHealthController } from './ai-health.controller.js';

/**
 * AI agent administration module (S-09.11, T-09.11.04 + T-09.11.05).
 *
 * Owns the durable `ai_agents` entity (admin CRUD) and the KB/policy link
 * orchestration. An agent references exactly one AI model (T-09.11.01) and
 * optionally links knowledge bases (T-09.11.02) and usage policies
 * (T-09.11.03). Slot assignment (T-09.11.05) maps the predefined chatbot
 * slots to agents. The isolated test chat previews the saved configuration.
 */
@Module({
  imports: [SessionModule, AiModelsModule, ProfilesModule],
  controllers: [
    AgentsController,
    AgentSlotsController,
    AiTestChatController,
    AiKnowledgeChatController,
    AiHealthController,
  ],
  providers: [AiAgentsService, AgentSlotsService, AiTestChatService, AiKnowledgeChatService],
  exports: [AiAgentsService, AgentSlotsService],
})
export class AiAgentsModule {}
