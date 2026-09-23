import { Module } from '@nestjs/common';
import { SessionModule } from '../session/session.module.js';
import { UploadModule } from '../upload/upload.module.js';
import { DocumentController, StaffDocumentController } from './document.controller.js';
import { DocumentService } from './document.service.js';
import { DocumentStorageService } from './document-storage.service.js';

@Module({
  imports: [SessionModule, UploadModule],
  controllers: [DocumentController, StaffDocumentController],
  providers: [DocumentService, DocumentStorageService],
  exports: [DocumentService],
})
export class DocumentModule {}
