import {
  Body,
  Controller,
  Get,
  HttpException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { parseStatusFilter, CONSULTATION_REQUEST_STATUSES } from '@barghsa/shared/validation';
import { SessionAuthGuard, type AuthenticatedRequest } from '../session/session.guard.js';
import { RateLimit } from '../rate-limit/rate-limit.decorator.js';
import { ApiZodBody } from '../openapi/zod-body.decorator.js';
import { ConsultationRequestService } from './consultation-request.service.js';

const submission = z
  .object({
    profileId: z.string().uuid(),
    productId: z.string().uuid(),
    submissionKey: z.string().uuid(),
  })
  .strict();

@ApiTags('Consultation requests')
@ApiBearerAuth()
@Controller('api/consultations')
@UseGuards(SessionAuthGuard)
export class ConsultationRequestController {
  constructor(private readonly service: ConsultationRequestService) {}

  @Get('products')
  @ApiOperation({ summary: 'List active consultation products available to a profile' })
  products(
    @Query('profileId', new ParseUUIDPipe()) profileId: string,
    @Req() req: AuthenticatedRequest
  ) {
    return this.service.products(req.session, profileId);
  }

  @Post('requests')
  @RateLimit({ namespace: 'consultation:submit:user', limit: 60, windowMs: 60_000, scope: 'user' })
  @ApiOperation({ summary: 'Submit a consultation request without creating an invoice' })
  @ApiZodBody(submission)
  submit(@Body() body: unknown, @Req() req: AuthenticatedRequest) {
    const parsed = submission.safeParse(body);
    if (!parsed.success) throw new HttpException({ error: 'VALIDATION:INPUT_INVALID' }, 400);
    return this.service.submit(req.session, parsed.data, req.ip ?? '127.0.0.1');
  }

  @Get('requests')
  @ApiOperation({ summary: 'List consultation requests for a profile' })
  @ApiQuery({ name: 'before', required: false, format: 'uuid', type: String })
  @ApiQuery({
    name: 'statuses',
    required: false,
    type: String,
    description: 'Comma-separated consultation request statuses',
  })
  list(
    @Query('profileId', new ParseUUIDPipe()) profileId: string,
    @Req() req: AuthenticatedRequest,
    @Query('before') before?: string,
    @Query('statuses') statuses?: string
  ) {
    if (before && !z.string().uuid().safeParse(before).success)
      throw new HttpException({ error: 'VALIDATION:INVALID_CURSOR' }, 400);
    const selectedStatuses = parseStatusFilter(statuses, CONSULTATION_REQUEST_STATUSES);
    if (!selectedStatuses) throw new HttpException({ error: 'VALIDATION:INPUT_INVALID' }, 400);
    return this.service.list(req.session, profileId, before, selectedStatuses);
  }

  @Get('requests/:id')
  @ApiOperation({ summary: 'Read a consultation request and status history' })
  detail(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: AuthenticatedRequest) {
    return this.service.detail(req.session, id);
  }
}
