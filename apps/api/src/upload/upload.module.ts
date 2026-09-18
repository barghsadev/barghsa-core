import { Module } from '@nestjs/common';
import { UploadController } from './upload.controller.js';
import { UploadPolicyResolver } from './upload-policy.resolver.js';
import { SessionModule } from '../session/index.js';
import { ProfilesModule } from '../profiles/profiles.module.js';

@Module({
  imports: [SessionModule, ProfilesModule],
  controllers: [UploadController],
  providers: [UploadPolicyResolver],
  exports: [UploadPolicyResolver],
})
export class UploadModule {}
