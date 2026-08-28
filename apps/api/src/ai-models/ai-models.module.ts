import { Module } from '@nestjs/common'
import { SessionModule } from '../session/index.js'
import { AiModelsController } from './ai-models.controller.js'
import { AiModelsService } from './ai-models.service.js'
import { AiModelSecretsService } from './ai-model-secrets.service.js'
import { AiModelTesterService } from './ai-model-tester.service.js'

/**
 * AI model administration module (S-09.11, T-09.11.01).
 *
 * Owns the durable `ai_models` entity (admin CRUD), encrypted-at-rest API
 * tokens, and the SSRF-guarded connection tester behind the admin test
 * button. Models are referenced by AI agents in T-09.11.04.
 */
@Module({
  imports: [SessionModule],
  controllers: [AiModelsController],
  providers: [AiModelsService, AiModelSecretsService, AiModelTesterService],
  exports: [AiModelsService, AiModelSecretsService, AiModelTesterService],
})
export class AiModelsModule {}
