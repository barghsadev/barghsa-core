import { Body, Controller, Get, HttpCode, Post, Put, Req, UseGuards } from '@nestjs/common';
import { SessionAuthGuard, type AuthenticatedRequest } from '../session/session.guard.js';
import { StepUpGuard, RequiresStepUp } from '../session/step-up.guard.js';
import { StorageAdminGuard } from './storage-admin.guard.js';
import { StorageConfigService } from './storage-config.service.js';

@Controller('api/admin/storage')
@UseGuards(SessionAuthGuard, StorageAdminGuard)
export class StorageAdminController {
  constructor(private readonly config: StorageConfigService) {}

  @Get('config')
  getConfig() {
    return this.config.get();
  }

  @Put('config')
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  @HttpCode(200)
  updateConfig(@Body() body: unknown, @Req() req: AuthenticatedRequest) {
    return this.config.save(body, req.session.userId);
  }

  @Post('test-connection')
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  @HttpCode(200)
  testConnection(@Body() body: unknown) {
    return this.config.test(body);
  }
}
