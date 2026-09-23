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
import { ApiZodBody } from '../openapi/zod-body.decorator.js';
import { RateLimit } from '../rate-limit/rate-limit.decorator.js';
import { SessionAuthGuard, type AuthenticatedRequest } from '../session/session.guard.js';
import { SavingOrderService } from './saving-order.service.js';

const quoteInput = z
  .object({
    profileId: z.string().uuid(),
    savingPlanId: z.string().uuid(),
    hardwareProductId: z.string().uuid(),
    billIdentifier: z.string().regex(/^[0-9]{6,13}$/),
    installationAddressId: z.string().uuid(),
    agreementVersionId: z.string().uuid(),
    giftCode: z.string().trim().min(1).max(100).optional(),
  })
  .strict();
const submissionInput = quoteInput
  .extend({
    idempotencyKey: z.string().uuid(),
    expectedQuoteDigest: z.string().regex(/^[a-f0-9]{64}$/),
    agreementAccepted: z.literal(true),
    hardwareConfirmed: z.literal(true),
    submitForStaffReview: z.literal(true),
  })
  .strict();
const changeInput = z
  .object({
    hardwareProductId: z.string().uuid(),
    installationAddressId: z.string().uuid(),
  })
  .strict();
const changeSubmissionInput = changeInput
  .extend({
    idempotencyKey: z.string().uuid(),
    expectedQuoteDigest: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
const verifyInput = z
  .object({
    profileId: z.string().uuid(),
    billIdentifier: z.string().regex(/^[0-9]{6,13}$/),
  })
  .strict();
const duplicateInput = verifyInput.extend({ savingPlanId: z.string().uuid() }).strict();

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) throw new HttpException({ error: 'VALIDATION:INPUT_INVALID' }, 400);
  return result.data;
}

@ApiTags('Saving orders')
@ApiBearerAuth()
@Controller('api/saving/orders')
@UseGuards(SessionAuthGuard)
export class SavingOrderController {
  constructor(private readonly service: SavingOrderService) {}

  @Post('duplicate')
  @RateLimit({ namespace: 'saving:duplicate:user', limit: 30, windowMs: 60_000 })
  @ApiOperation({ summary: 'Check for an active saving order for this bill and plan' })
  @ApiZodBody(duplicateInput)
  duplicate(@Body() body: unknown, @Req() req: AuthenticatedRequest) {
    const input = parse(duplicateInput, body);
    return this.service.duplicate(
      req.session,
      input.profileId,
      input.savingPlanId,
      input.billIdentifier
    );
  }

  @Get()
  @RateLimit({ namespace: 'saving:order-list:user', limit: 60, windowMs: 60_000 })
  @ApiOperation({ summary: 'List saving orders for a customer profile' })
  list(
    @Query('profileId', new ParseUUIDPipe()) profileId: string,
    @Req() req: AuthenticatedRequest
  ) {
    return this.service.list(req.session, profileId);
  }

  @Get(':id')
  @RateLimit({ namespace: 'saving:order-detail:user', limit: 60, windowMs: 60_000 })
  @ApiOperation({ summary: 'Read saving order, invoice, contract and fulfillment progress' })
  detail(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: AuthenticatedRequest) {
    return this.service.detail(req.session, id);
  }

  @Post(':id/change-quote')
  @RateLimit({ namespace: 'saving:change-quote:user', limit: 30, windowMs: 60_000 })
  @ApiOperation({ summary: 'Quote an unpaid saving order equipment or address change' })
  @ApiZodBody(changeInput)
  quoteChange(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest
  ) {
    return this.service.quoteChange(req.session, id, parse(changeInput, body));
  }

  @Post(':id/change')
  @RateLimit({ namespace: 'saving:change:user', limit: 10, windowMs: 60_000 })
  @ApiOperation({
    summary: 'Atomically revise an unpaid saving order, invoice, contract and inventory',
  })
  @ApiZodBody(changeSubmissionInput)
  change(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest
  ) {
    return this.service.change(
      req.session,
      id,
      parse(changeSubmissionInput, body),
      req.ip ?? '127.0.0.1'
    );
  }

  @Post('verify-bill')
  @RateLimit({ namespace: 'saving:verify-bill:user', limit: 10, windowMs: 60_000 })
  @ApiOperation({ summary: 'Optional bill identifier verification with manual-review fallback' })
  @ApiZodBody(verifyInput)
  verify(@Body() body: unknown, @Req() req: AuthenticatedRequest) {
    const input = parse(verifyInput, body);
    return this.service.verifyBill(req.session, input.profileId, input.billIdentifier);
  }

  @Post('quote')
  @RateLimit({ namespace: 'saving:quote:user', limit: 60, windowMs: 60_000, scope: 'user' })
  @ApiOperation({ summary: 'Authoritative saving plan, hardware, discount and VAT quote' })
  @ApiZodBody(quoteInput)
  quote(@Body() body: unknown, @Req() req: AuthenticatedRequest) {
    return this.service.quote(req.session, parse(quoteInput, body));
  }

  @Post()
  @RateLimit({ namespace: 'saving:submit:user', limit: 60, windowMs: 60_000, scope: 'user' })
  @ApiOperation({ summary: 'Atomically submit saving order, contract and unpaid invoice' })
  @ApiZodBody(submissionInput)
  submit(@Body() body: unknown, @Req() req: AuthenticatedRequest) {
    return this.service.submit(req.session, parse(submissionInput, body), req.ip ?? '127.0.0.1');
  }
}
