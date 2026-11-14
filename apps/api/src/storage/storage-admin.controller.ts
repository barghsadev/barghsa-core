import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiQuery } from '@nestjs/swagger';
import {
  activateRecoveryDraft,
  activationHistoryQuery,
  stageRecoveryDraft,
} from '../admin/config-activation-history.js';
import { ApiZodBody } from '../openapi/zod-body.decorator.js';
import { ErrorCodes } from '@barghsa/shared/errors';
import { SessionAuthGuard, type AuthenticatedRequest } from '../session/session.guard.js';
import { StepUpGuard, RequiresStepUp } from '../session/step-up.guard.js';
import { StorageAdminGuard } from './storage-admin.guard.js';
import { StorageConfigService } from './storage-config.service.js';

@Controller('api/admin/storage')
@UseGuards(SessionAuthGuard, StorageAdminGuard)
export class StorageAdminController {
  constructor(private readonly config: StorageConfigService) {}

  @Get('multipart-cleanup-policy')
  getMultipartCleanupPolicy() {
    return this.config.getMultipartCleanupPolicy();
  }

  @Put('multipart-cleanup-policy')
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  @HttpCode(200)
  updateMultipartCleanupPolicy(@Body() body: unknown, @Req() req: AuthenticatedRequest) {
    return this.config.saveMultipartCleanupPolicy(body, req.session);
  }

  @Get('multipart-cleanup-policy/rollback-history')
  @ApiOperation({ summary: 'Read previous multipart cleanup age settings' })
  @ApiQuery({ name: 'beforeVersion', required: false, type: Number })
  cleanupRecoveryHistory(@Req() req: AuthenticatedRequest, @Query() query: unknown) {
    const parsed = activationHistoryQuery.safeParse(query);
    if (!parsed.success)
      throw new BadRequestException({ error: ErrorCodes.VALIDATION_INPUT_INVALID.code });
    return this.config.cleanupHistory(req.session, parsed.data.beforeVersion);
  }

  @Post('multipart-cleanup-policy/rollback-draft')
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  @ApiOperation({ summary: 'Prepare a multipart cleanup age recovery draft' })
  @ApiZodBody(stageRecoveryDraft)
  prepareCleanupRecovery(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    const parsed = stageRecoveryDraft.safeParse(body);
    if (!parsed.success)
      throw new BadRequestException({ error: ErrorCodes.VALIDATION_INPUT_INVALID.code });
    return this.config.prepareCleanupRecovery(parsed.data, req.session);
  }

  @Post('multipart-cleanup-policy/rollback-activate')
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  @HttpCode(200)
  @ApiOperation({ summary: 'Activate a reviewed multipart cleanup age recovery draft' })
  @ApiZodBody(activateRecoveryDraft)
  activateCleanupRecovery(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    const parsed = activateRecoveryDraft.safeParse(body);
    if (!parsed.success)
      throw new BadRequestException({ error: ErrorCodes.VALIDATION_INPUT_INVALID.code });
    return this.config.activateCleanupRecovery(parsed.data, req.session);
  }

  @Get('config')
  getConfig() {
    return this.config.get();
  }

  @Put('config')
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  @HttpCode(200)
  updateConfig(@Body() body: unknown, @Req() req: AuthenticatedRequest) {
    return this.config.save(body, req.session);
  }

  @Get('config/rollback-history')
  @ApiOperation({ summary: 'Read previous storage connection settings' })
  @ApiQuery({ name: 'beforeVersion', required: false, type: Number })
  recoveryHistory(@Req() req: AuthenticatedRequest, @Query() query: unknown) {
    const parsed = activationHistoryQuery.safeParse(query);
    if (!parsed.success)
      throw new BadRequestException({ error: ErrorCodes.VALIDATION_INPUT_INVALID.code });
    return this.config.history(req.session, parsed.data.beforeVersion);
  }

  @Post('config/rollback-draft')
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  @ApiOperation({ summary: 'Prepare a storage recovery draft without historical credentials' })
  @ApiZodBody(stageRecoveryDraft)
  prepareRecovery(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    const parsed = stageRecoveryDraft.safeParse(body);
    if (!parsed.success)
      throw new BadRequestException({ error: ErrorCodes.VALIDATION_INPUT_INVALID.code });
    return this.config.prepareRecovery(parsed.data, req.session);
  }

  @Post('config/rollback-activate')
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  @HttpCode(200)
  @ApiOperation({ summary: 'Probe and activate a reviewed storage recovery draft' })
  @ApiZodBody(activateRecoveryDraft)
  activateRecovery(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    const parsed = activateRecoveryDraft.safeParse(body);
    if (!parsed.success)
      throw new BadRequestException({ error: ErrorCodes.VALIDATION_INPUT_INVALID.code });
    return this.config.activateRecovery(parsed.data, req.session);
  }

  @Post('test-connection')
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  @HttpCode(200)
  testConnection(@Body() body: unknown, @Req() req: AuthenticatedRequest) {
    return this.config.test(body, req.session);
  }
}
