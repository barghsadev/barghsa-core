import {
  Body,
  Controller,
  Get,
  HttpException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ApiZodBody } from '../openapi/zod-body.decorator.js';
import { RateLimit } from '../rate-limit/rate-limit.decorator.js';
import { SessionAuthGuard, type AuthenticatedRequest } from '../session/session.guard.js';
import { SolarRequestService } from './solar-request.service.js';
import { solarDraftInput, solarSubmission } from './solar-request.validation.js';

@ApiTags('Solar construction requests')
@ApiBearerAuth()
@Controller('api/solar/requests')
@UseGuards(SessionAuthGuard)
export class SolarRequestController {
  constructor(private readonly service: SolarRequestService) {}

  @Get('draft')
  @RateLimit({ namespace: 'solar:draft-read:user', limit: 60, windowMs: 60_000 })
  @ApiOperation({ summary: 'Resume a profile-owned solar request form' })
  getDraft(
    @Query('profileId', new ParseUUIDPipe()) profileId: string,
    @Req() req: AuthenticatedRequest
  ) {
    return this.service.getDraft(req.session, profileId);
  }

  @Put('draft')
  @RateLimit({ namespace: 'solar:draft-write:user', limit: 60, windowMs: 60_000 })
  @ApiOperation({ summary: 'Save a profile-owned solar request form draft' })
  @ApiZodBody(solarDraftInput)
  saveDraft(@Body() body: unknown, @Req() req: AuthenticatedRequest) {
    const input = solarDraftInput.safeParse(body);
    if (!input.success) throw new HttpException({ error: 'VALIDATION:INPUT_INVALID' }, 400);
    return this.service.saveDraft(req.session, input.data);
  }

  @Post()
  @RateLimit({ namespace: 'solar:submit:user', limit: 60, windowMs: 60_000, scope: 'user' })
  @ApiOperation({
    summary: 'Submit a solar construction request without creating a contract or invoice',
  })
  @ApiZodBody(solarSubmission)
  submit(@Body() body: unknown, @Req() req: AuthenticatedRequest) {
    const input = solarSubmission.safeParse(body);
    if (!input.success) throw new HttpException({ error: 'VALIDATION:INPUT_INVALID' }, 400);
    return this.service.submit(req.session, input.data, req.ip ?? '127.0.0.1');
  }

  @Get()
  @RateLimit({ namespace: 'solar:list:user', limit: 60, windowMs: 60_000 })
  @ApiOperation({ summary: 'List solar construction requests for a profile' })
  @ApiQuery({ name: 'before', required: false, format: 'uuid' })
  list(
    @Query('profileId', new ParseUUIDPipe()) profileId: string,
    @Req() req: AuthenticatedRequest,
    @Query('before') before?: string
  ) {
    if (before && !z.string().uuid().safeParse(before).success)
      throw new HttpException({ error: 'VALIDATION:INVALID_CURSOR' }, 400);
    return this.service.list(req.session, profileId, before);
  }

  @Get(':id')
  @RateLimit({ namespace: 'solar:detail:user', limit: 60, windowMs: 60_000 })
  @ApiOperation({ summary: 'Read a solar construction request and its current stage' })
  detail(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: AuthenticatedRequest) {
    return this.service.detail(req.session, id);
  }
}
