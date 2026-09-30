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
import {
  parseDateRangeFilter,
  parseStatusFilter,
  SOLAR_REQUEST_STATUSES,
} from '@barghsa/shared/validation';
import { ApiZodBody } from '../openapi/zod-body.decorator.js';
import { RateLimit } from '../rate-limit/rate-limit.decorator.js';
import { SessionAuthGuard, type AuthenticatedRequest } from '../session/session.guard.js';
import { SolarRequestService } from './solar-request.service.js';
import {
  solarDraftInput,
  solarSubmission,
  solarSubmissionReview,
  type SolarSubmission,
} from './solar-request.validation.js';
import { RequiresCapability } from '../maintenance/maintenance.guard.js';

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

  @Post('review')
  @RequiresCapability('solar_requests')
  @RateLimit({ namespace: 'solar:review:user', limit: 60, windowMs: 60_000, scope: 'user' })
  @ApiOperation({ summary: 'Review the authoritative solar request details before submission' })
  @ApiZodBody(solarSubmissionReview)
  review(@Body() body: unknown, @Req() req: AuthenticatedRequest) {
    const input = solarSubmissionReview.safeParse(body);
    if (!input.success) throw new HttpException({ error: 'VALIDATION:INPUT_INVALID' }, 400);
    return this.service.review(req.session, input.data);
  }

  @Post()
  @RequiresCapability('solar_requests')
  @RateLimit({ namespace: 'solar:submit:user', limit: 60, windowMs: 60_000, scope: 'user' })
  @ApiOperation({
    summary: 'Submit a solar construction request without creating a contract or invoice',
  })
  @ApiZodBody(solarSubmission)
  submit(@Body() body: unknown, @Req() req: AuthenticatedRequest) {
    const input = solarSubmission.safeParse(body);
    if (!input.success) throw new HttpException({ error: 'VALIDATION:INPUT_INVALID' }, 400);
    return this.service.submit(req.session, input.data as SolarSubmission, req.ip ?? '127.0.0.1');
  }

  @Get()
  @RateLimit({ namespace: 'solar:list:user', limit: 60, windowMs: 60_000 })
  @ApiOperation({ summary: 'List solar construction requests for a profile' })
  @ApiQuery({ name: 'before', required: false, format: 'uuid' })
  @ApiQuery({
    name: 'statuses',
    required: false,
    type: String,
    description: 'Comma-separated solar request statuses',
  })
  @ApiQuery({
    name: 'from',
    required: false,
    type: String,
    description: 'Included UTC submission timestamp (ISO with milliseconds)',
  })
  @ApiQuery({
    name: 'to',
    required: false,
    type: String,
    description: 'Excluded UTC submission timestamp (ISO with milliseconds)',
  })
  list(
    @Query('profileId', new ParseUUIDPipe()) profileId: string,
    @Req() req: AuthenticatedRequest,
    @Query('before') before?: string,
    @Query('statuses') statuses?: string,
    @Query('from') from?: string,
    @Query('to') to?: string
  ) {
    if (before && !z.string().uuid().safeParse(before).success)
      throw new HttpException({ error: 'VALIDATION:INVALID_CURSOR' }, 400);
    const selectedStatuses = parseStatusFilter(statuses, SOLAR_REQUEST_STATUSES);
    if (!selectedStatuses) throw new HttpException({ error: 'VALIDATION:INPUT_INVALID' }, 400);
    const range = parseDateRangeFilter(from, to);
    if (!range) throw new HttpException({ error: 'VALIDATION:INPUT_INVALID' }, 400);
    return this.service.list(req.session, profileId, before, selectedStatuses, range);
  }

  @Get(':id')
  @RateLimit({ namespace: 'solar:detail:user', limit: 60, windowMs: 60_000 })
  @ApiOperation({ summary: 'Read a solar construction request and its current stage' })
  detail(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: AuthenticatedRequest) {
    return this.service.detail(req.session, id);
  }
}
