import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  HttpCode,
  HttpStatus,
  ConflictException,
  Req,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { SessionAuthGuard, type AuthenticatedRequest } from '../session/session.guard.js';
import { StepUpGuard, RequiresStepUp } from '../session/step-up.guard.js';
import { StorageAdminGuard } from './storage-admin.guard.js';
import { StorageRecordAdminService } from './storage-record-admin.service.js';

@Controller('api/admin/storage/records')
@UseGuards(SessionAuthGuard, StorageAdminGuard)
export class StorageRecordsController {
  constructor(private readonly records: StorageRecordAdminService) {}
  @Get(':key')
  getRecord(@Param('key') key: string) {
    return this.records.get(key);
  }

  @Post(':key/sign')
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  @HttpCode(HttpStatus.OK)
  async signRecord(
    @Param('key') key: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest
  ) {
    // The signed-by identity comes exclusively from the authenticated request.
    if (
      body != null &&
      (typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length)
    )
      throw new BadRequestException('Signing does not accept a supplied actor');
    return (await this.records.mutate(key, 'sign', req.session.userId, req.ip ?? 'unknown')).record;
  }

  @Delete(':key')
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteRecord(@Param('key') key: string, @Req() req: AuthenticatedRequest) {
    const result = await this.records.mutate(
      key,
      'remove',
      req.session.userId,
      req.ip ?? 'unknown'
    );
    if (result.retained && !result.alreadyRemoved)
      throw new ConflictException(
        'The record was removed from active use; its signed file is retained.'
      );
  }
}
