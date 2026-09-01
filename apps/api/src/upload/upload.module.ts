import { Module } from '@nestjs/common';
import { UploadController } from './upload.controller.js';
import { UploadPolicyResolver } from './upload-policy.resolver.js';
import { SessionModule } from '../session/index.js';

@Module({
  imports: [SessionModule],
  controllers: [UploadController],
  providers: [UploadPolicyResolver],
  exports: [UploadPolicyResolver],
})
export class UploadModule {}
