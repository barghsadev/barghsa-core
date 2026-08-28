import { Module } from '@nestjs/common'
import { SessionModule } from '../session/index.js'
import { KnowledgeBasesController, KbGroupsController } from './knowledge-bases.controller.js'
import { KnowledgeBasesService } from './knowledge-bases.service.js'

/**
 * Knowledge base administration module (S-09.11, T-09.11.02).
 *
 * Owns the durable `knowledge_bases`, `kb_documents`, `kb_groups`, and
 * `kb_group_members` entities (admin CRUD + document linking + group
 * membership). Documents are attached by storage key referencing the
 * shared document system (`storage_records`); the chunk/embed worker
 * pipeline is supplied by the document-processing epic (E-05) and claims
 * rows through `kb_documents.processing_status`.
 */
@Module({
  imports: [SessionModule],
  controllers: [KnowledgeBasesController, KbGroupsController],
  providers: [KnowledgeBasesService],
  exports: [KnowledgeBasesService],
})
export class KnowledgeBasesModule {}