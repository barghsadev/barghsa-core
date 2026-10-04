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
import {
  parseDateRangeFilter,
  parseHistoryQuery,
  HISTORY_SORT_OPTIONS,
  parseStatusFilter,
  CONSULTATION_REQUEST_STATUSES,
} from '@barghsa/shared/validation';
import { SessionAuthGuard, type AuthenticatedRequest } from '../session/session.guard.js';
import { RateLimit } from '../rate-limit/rate-limit.decorator.js';
import { ApiZodBody } from '../openapi/zod-body.decorator.js';
import { ConsultationRequestService } from './consultation-request.service.js';
import { InputFieldException } from '../common/input-field.exception.js';

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
    if (!parsed.success) {
      if (
        parsed.error.issues.length &&
        parsed.error.issues.every(
          (issue) =>
            issue.path.length === 1 &&
            issue.path[0] === 'productId' &&
            ['invalid_type', 'invalid_format'].includes(issue.code)
        )
      )
        throw new InputFieldException(['productId']);
      throw new HttpException({ error: 'VALIDATION:INPUT_INVALID' }, 400);
    }
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
  @ApiQuery({
    name: 'q',
    required: false,
    type: String,
    description: 'Literal substring search, up to 120 characters',
  })
  @ApiQuery({ name: 'sort', required: false, enum: [...HISTORY_SORT_OPTIONS] })
  list(
    @Query('profileId', new ParseUUIDPipe()) profileId: string,
    @Req() req: AuthenticatedRequest,
    @Query('before') before?: string,
    @Query('statuses') statuses?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('q') q?: string,
    @Query('sort') sort?: string
  ) {
    if (before && !z.string().uuid().safeParse(before).success)
      throw new HttpException({ error: 'VALIDATION:INVALID_CURSOR' }, 400);
    const selectedStatuses = parseStatusFilter(statuses, CONSULTATION_REQUEST_STATUSES);
    if (!selectedStatuses) throw new HttpException({ error: 'VALIDATION:INPUT_INVALID' }, 400);
    const range = parseDateRangeFilter(from, to);
    if (!range) throw new HttpException({ error: 'VALIDATION:INPUT_INVALID' }, 400);
    const query = parseHistoryQuery(q, sort);
    if (!query) throw new HttpException({ error: 'VALIDATION:INPUT_INVALID' }, 400);
    return this.service.list(req.session, profileId, before, selectedStatuses, range, query);
  }

  @Get('requests/:id')
  @ApiOperation({ summary: 'Read a consultation request and status history' })
  detail(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: AuthenticatedRequest) {
    return this.service.detail(req.session, id);
  }
}
