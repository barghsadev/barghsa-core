import { Module } from '@nestjs/common';
import { SessionModule } from '../session/index.js';
import { JobsController } from './jobs.controller.js';
import { JobService } from './jobs.service.js';

@Module({
  imports: [SessionModule],
  controllers: [JobsController],
  providers: [JobService],
  exports: [JobService],
})
export class JobsModule {}
