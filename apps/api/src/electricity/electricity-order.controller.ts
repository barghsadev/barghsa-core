import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { validatePostalCode } from '@barghsa/shared/validation';
import { ApiZodBody } from '../openapi/zod-body.decorator.js';
import { RateLimit } from '../rate-limit/rate-limit.decorator.js';
import { SessionAuthGuard, type AuthenticatedRequest } from '../session/session.guard.js';
import { ElectricityOrderService } from './electricity-order.service.js';
import { simplePeriodOptions } from './electricity-order.service.js';
import { ElectricityBillDataService } from './electricity-bill-data.service.js';
import { ElectricityDraftService } from './electricity-draft.service.js';

const simpleInput = z
  .object({
    profileId: z.string().uuid(),
    period: z.enum(['current_month', 'next_month', 'current_week', 'next_week', 'week_after_next']),
    totalKwh: z
      .string()
      .regex(/^[1-9]\d*$/)
      .max(19),
    giftCode: z.string().trim().min(1).max(100).optional(),
  })
  .strict();
const submitInput = simpleInput
  .extend({
    idempotencyKey: z.string().uuid(),
    expectedQuoteDigest: z.string().regex(/^[a-f0-9]{64}$/),
    address: z
      .object({
        provinceId: z.string().uuid(),
        cityId: z.string().uuid(),
        fullAddress: z.string().trim().min(1).max(500),
        postalCode: z.string().trim().refine(validatePostalCode),
      })
      .strict(),
  })
  .strict();
const advancedInput = z
  .object({
    profileId: z.string().uuid(),
    startAt: z.string().datetime({ offset: true }),
    endAt: z.string().datetime({ offset: true }),
    quantities: z
      .object({
        thermal: z.string().regex(/^\d+$/).max(19).optional(),
        green: z.string().regex(/^\d+$/).max(19).optional(),
        free_market: z.string().regex(/^\d+$/).max(19).optional(),
        energy_saving: z.string().regex(/^\d+$/).max(19).optional(),
      })
      .strict(),
    giftCode: z.string().trim().min(1).max(100).optional(),
  })
  .strict();
const advancedSubmitInput = advancedInput
  .extend({
    idempotencyKey: z.string().uuid(),
    expectedQuoteDigest: z.string().regex(/^[a-f0-9]{64}$/),
    address: submitInput.shape.address,
  })
  .strict();
const advancedDraftInput = z
  .object({
    profileId: z.string().uuid(),
    currentStep: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
    data: z
      .object({
        startAt: z.string().datetime({ offset: true }).optional(),
        endAt: z.string().datetime({ offset: true }).optional(),
        quantities: advancedInput.shape.quantities,
        giftCode: z.string().trim().min(1).max(100).optional(),
        addressId: z.string().uuid().optional(),
      })
      .strict(),
  })
  .strict();
const draftInput = z
  .object({
    profileId: z.string().uuid(),
    currentStep: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
    data: z
      .object({
        period: z.enum([
          'current_month',
          'next_month',
          'current_week',
          'next_week',
          'week_after_next',
        ]),
        totalKwh: z
          .string()
          .regex(/^[1-9]\d*$/)
          .max(19)
          .optional(),
        giftCode: z.string().trim().min(1).max(100).optional(),
        giftCodeInput: z.string().max(100).optional(),
        addressId: z.string().uuid().optional(),
      })
      .strict(),
  })
  .strict();
const addressCorrectionInput = z
  .object({
    idempotencyKey: z.string().uuid(),
    expectedVersionId: z.string().uuid(),
    fullAddress: z.string().trim().min(1).max(500),
    postalCode: z.string().trim().refine(validatePostalCode),
    responseNote: z.string().trim().min(1).max(1000),
  })
  .strict();
const cancelInput = z
  .object({
    idempotencyKey: z.string().uuid(),
    expectedVersionId: z.string().uuid(),
    reason: z.string().trim().min(1).max(1000),
  })
  .strict();

@ApiTags('Electricity')
@Controller('api/electricity')
@UseGuards(SessionAuthGuard)
export class ElectricityOrderController {
  constructor(
    private readonly service: ElectricityOrderService,
    private readonly billData: ElectricityBillDataService,
    private readonly drafts: ElectricityDraftService
  ) {}

  @Get('periods/simple')
  @RateLimit({ namespace: 'electricity:periods:user', limit: 60, windowMs: 60_000 })
  @ApiOperation({ summary: 'Available server-calculated Jalali month and week periods' })
  @ApiResponse({ status: 200, description: 'Five selectable period ranges in Iran time.' })
  periods() {
    return { periods: simplePeriodOptions(new Date()) };
  }

  @Get('periods/advanced')
  @RateLimit({ namespace: 'electricity:periods:user', limit: 60, windowMs: 60_000 })
  @ApiOperation({ summary: 'Current advanced delivery limits and mandatory-green setting' })
  advancedPeriods(@Req() req: AuthenticatedRequest) {
    return this.service.advancedOptions(req.session);
  }

  @Get('drafts/advanced')
  @RateLimit({ namespace: 'electricity:draft-read:user', limit: 60, windowMs: 60_000 })
  @ApiOperation({ summary: 'Resume the current advanced electricity order draft' })
  getAdvancedDraft(
    @Query('profileId', new ParseUUIDPipe()) profileId: string,
    @Req() req: AuthenticatedRequest
  ) {
    return this.drafts.get(req.session, profileId, 'advanced');
  }

  @Put('drafts/advanced')
  @RateLimit({ namespace: 'electricity:draft-write:user', limit: 60, windowMs: 60_000 })
  @ApiOperation({ summary: 'Save an advanced electricity order draft' })
  @ApiZodBody(advancedDraftInput)
  saveAdvancedDraft(@Body() body: unknown, @Req() req: AuthenticatedRequest) {
    const parsed = advancedDraftInput.safeParse(body);
    if (!parsed.success) throw new HttpException({ error: 'VALIDATION:INPUT_INVALID' }, 400);
    return this.drafts.save(req.session, parsed.data, 'advanced');
  }

  @Get('drafts/simple')
  @RateLimit({ namespace: 'electricity:draft-read:user', limit: 60, windowMs: 60_000 })
  @ApiOperation({ summary: 'Resume the current customer simple-order draft' })
  @ApiResponse({ status: 200, description: 'Saved inputs and current step, or an empty draft.' })
  getDraft(
    @Query('profileId', new ParseUUIDPipe()) profileId: string,
    @Req() req: AuthenticatedRequest
  ) {
    return this.drafts.get(req.session, profileId);
  }

  @Put('drafts/simple')
  @RateLimit({ namespace: 'electricity:draft-write:user', limit: 60, windowMs: 60_000 })
  @ApiOperation({ summary: 'Save completed simple-order steps for safe resumption' })
  @ApiZodBody(draftInput)
  @ApiResponse({ status: 200, description: 'Saved draft and current step.' })
  saveDraft(@Body() body: unknown, @Req() req: AuthenticatedRequest) {
    const parsed = draftInput.safeParse(body);
    if (!parsed.success || (parsed.data.currentStep >= 3 && !parsed.data.data.totalKwh)) {
      throw new HttpException({ error: 'VALIDATION:INPUT_INVALID' }, 400);
    }
    return this.drafts.save(req.session, parsed.data);
  }

  @Get('bill-data/:profileId')
  @RateLimit({ namespace: 'electricity:bill-data:user', limit: 30, windowMs: 60_000 })
  @ApiOperation({ summary: 'Historical hourly bill-data estimate, with manual-entry fallback' })
  @ApiResponse({ status: 200, description: 'Estimate or a non-blocking unavailable reason.' })
  async getBillData(
    @Param('profileId', new ParseUUIDPipe()) profileId: string,
    @Query('period') period: string,
    @Req() req: AuthenticatedRequest
  ) {
    const selected = z
      .enum(['current_month', 'next_month', 'current_week', 'next_week', 'week_after_next'])
      .safeParse(period);
    if (!selected.success) throw new HttpException({ error: 'VALIDATION:INPUT_INVALID' }, 400);
    return this.billData.get(req.session, profileId, selected.data);
  }

  @Get('orders/:orderId')
  @RateLimit({ namespace: 'electricity:order-detail:user', limit: 60, windowMs: 60_000 })
  @ApiOperation({ summary: 'Customer electricity order confirmation and current references' })
  @ApiResponse({ status: 200, description: 'Order, contract and invoice detail.' })
  detail(@Param('orderId', new ParseUUIDPipe()) orderId: string, @Req() req: AuthenticatedRequest) {
    return this.service.detail(req.session, orderId);
  }

  @Get('orders')
  @RateLimit({ namespace: 'electricity:order-list:user', limit: 60, windowMs: 60_000 })
  @ApiOperation({
    summary: 'Profile-scoped electricity orders with commercial and financial progress',
  })
  @ApiResponse({ status: 200, description: 'Newest electricity orders and next-page cursor.' })
  list(
    @Query('profileId', new ParseUUIDPipe()) profileId: string,
    @Query('before') before: string | undefined,
    @Req() req: AuthenticatedRequest
  ) {
    if (before && !z.string().uuid().safeParse(before).success)
      throw new HttpException({ error: 'VALIDATION:INPUT_INVALID' }, 400);
    return this.service.list(req.session, profileId, before);
  }

  @Post('orders/:orderId/resubmit-address')
  @HttpCode(200)
  @RateLimit({ namespace: 'electricity:address-correction:user', limit: 10, windowMs: 60_000 })
  @ApiOperation({ summary: 'Resubmit a corrected delivery address after staff request' })
  @ApiZodBody(addressCorrectionInput)
  @ApiResponse({ status: 200, description: 'New preliminary contract version queued for review.' })
  resubmitAddress(
    @Param('orderId', new ParseUUIDPipe()) orderId: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest
  ) {
    const parsed = addressCorrectionInput.safeParse(body);
    if (!parsed.success) throw new HttpException({ error: 'VALIDATION:INPUT_INVALID' }, 400);
    return this.service.resubmitAddressCorrection(
      req.session,
      orderId,
      parsed.data,
      req.ip ?? 'unknown'
    );
  }

  @Post('orders/:orderId/cancel')
  @HttpCode(200)
  @RateLimit({ namespace: 'electricity:order-cancel:user', limit: 10, windowMs: 60_000 })
  @ApiOperation({
    summary: 'Cancel an unpublished electricity order and queue any mandatory refund',
  })
  @ApiZodBody(cancelInput)
  @ApiResponse({ status: 200, description: 'Cancelled order and mandatory refund reference.' })
  cancel(
    @Param('orderId', new ParseUUIDPipe()) orderId: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest
  ) {
    const parsed = cancelInput.safeParse(body);
    if (!parsed.success) throw new HttpException({ error: 'VALIDATION:INPUT_INVALID' }, 400);
    return this.service.cancel(req.session, orderId, parsed.data, req.ip ?? 'unknown');
  }

  @Post('preview/simple')
  @HttpCode(200)
  @RateLimit({ namespace: 'electricity:preview:user', limit: 60, windowMs: 60_000 })
  @ApiOperation({ summary: 'Quote a simple electricity order using current authoritative prices' })
  @ApiZodBody(simpleInput)
  @ApiResponse({ status: 200, description: 'Current period, lines, discount, VAT and total.' })
  async preview(@Body() body: unknown, @Req() req: AuthenticatedRequest) {
    const parsed = simpleInput.safeParse(body);
    if (!parsed.success) throw new HttpException({ error: 'VALIDATION:INPUT_INVALID' }, 400);
    return this.service.preview(req.session, parsed.data);
  }

  @Post('orders/simple')
  @HttpCode(201)
  @RateLimit({ namespace: 'electricity:submit:user', limit: 60, windowMs: 60_000, scope: 'user' })
  @ApiOperation({
    summary: 'Submit a simple electricity order with contract and invoice atomically',
  })
  @ApiZodBody(submitInput)
  @ApiResponse({ status: 201, description: 'Submitted order, contract, invoice and frozen quote.' })
  async submit(@Body() body: unknown, @Req() req: AuthenticatedRequest) {
    const parsed = submitInput.safeParse(body);
    if (!parsed.success) throw new HttpException({ error: 'VALIDATION:INPUT_INVALID' }, 400);
    return this.service.submit(req.session, parsed.data, req.ip ?? 'unknown');
  }

  @Post('preview/advanced')
  @HttpCode(200)
  @RateLimit({ namespace: 'electricity:preview:user', limit: 60, windowMs: 60_000 })
  @ApiOperation({
    summary: 'Quote an advanced four-product electricity bundle and custom delivery period',
  })
  @ApiZodBody(advancedInput)
  @ApiResponse({
    status: 200,
    description: 'Authoritative energy, price, green rule and wallet preview.',
  })
  previewAdvanced(@Body() body: unknown, @Req() req: AuthenticatedRequest) {
    const parsed = advancedInput.safeParse(body);
    if (!parsed.success) throw new HttpException({ error: 'VALIDATION:INPUT_INVALID' }, 400);
    return this.service.preview(req.session, parsed.data);
  }

  @Post('orders/advanced')
  @HttpCode(201)
  @RateLimit({ namespace: 'electricity:submit:user', limit: 60, windowMs: 60_000, scope: 'user' })
  @ApiOperation({ summary: 'Submit an advanced bundle with contract and invoice atomically' })
  @ApiZodBody(advancedSubmitInput)
  @ApiResponse({ status: 201, description: 'Order, contract, invoice and frozen quote.' })
  submitAdvanced(@Body() body: unknown, @Req() req: AuthenticatedRequest) {
    const parsed = advancedSubmitInput.safeParse(body);
    if (!parsed.success) throw new HttpException({ error: 'VALIDATION:INPUT_INVALID' }, 400);
    return this.service.submit(req.session, parsed.data, req.ip ?? 'unknown');
  }
}
