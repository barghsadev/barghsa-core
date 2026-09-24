import { Module } from '@nestjs/common';
import { SessionModule } from '../session/session.module.js';
import { UploadModule } from '../upload/upload.module.js';
import { DocumentController, StaffDocumentController } from './document.controller.js';
import { DocumentService } from './document.service.js';
import { DocumentStorageService } from './document-storage.service.js';
import { DocumentTemplateController } from './document-template.controller.js';
import { DocumentTemplateService } from './document-template.service.js';
import { DocumentRetentionController } from './document-retention.controller.js';
import { DocumentRetentionService } from './document-retention.service.js';

@Module({
  imports: [SessionModule, UploadModule],
  controllers: [
    DocumentController,
    StaffDocumentController,
    DocumentTemplateController,
    DocumentRetentionController,
  ],
  providers: [
    DocumentService,
    DocumentStorageService,
    DocumentTemplateService,
    DocumentRetentionService,
  ],
  exports: [DocumentService],
})
export class DocumentModule {}
