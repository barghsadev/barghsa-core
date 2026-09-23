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
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
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
  list(
    @Query('profileId', new ParseUUIDPipe()) profileId: string,
    @Req() req: AuthenticatedRequest
  ) {
    return this.service.list(req.session, profileId);
  }

  @Get('requests/:id')
  @ApiOperation({ summary: 'Read a consultation request and status history' })
  detail(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: AuthenticatedRequest) {
    return this.service.detail(req.session, id);
  }
}
