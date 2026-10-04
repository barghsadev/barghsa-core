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
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  validatePostalCode,
  parseStatusFilter,
  parseDateRangeFilter,
  parseHistoryQuery,
  ELECTRICITY_ORDER_STATUSES,
  HISTORY_SORT_OPTIONS,
} from '@barghsa/shared/validation';
import { ApiZodBody } from '../openapi/zod-body.decorator.js';
import { RateLimit } from '../rate-limit/rate-limit.decorator.js';
import { SessionAuthGuard, type AuthenticatedRequest } from '../session/session.guard.js';
import { ElectricityOrderService } from './electricity-order.service.js';
import { simplePeriodOptions } from './electricity-order.service.js';
import { ElectricityBillDataService } from './electricity-bill-data.service.js';
import { ElectricityDraftService } from './electricity-draft.service.js';
import { RequiresCapability } from '../maintenance/maintenance.guard.js';
import { InputFieldException } from '../common/input-field.exception.js';

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
const simpleRevisionPreview = simpleInput.extend({ expectedVersionId: z.string().uuid() }).strict();
const advancedRevisionPreview = advancedInput
  .extend({ expectedVersionId: z.string().uuid() })
  .strict();
const revisionPreviewInput = z.union([simpleRevisionPreview, advancedRevisionPreview]);
const simpleRevision = submitInput
  .extend({
    expectedVersionId: z.string().uuid(),
    responseNote: z.string().trim().min(1).max(1000),
  })
  .strict();
const advancedRevision = advancedSubmitInput
  .extend({
    expectedVersionId: z.string().uuid(),
    responseNote: z.string().trim().min(1).max(1000),
  })
  .strict();
const revisionInput = z.union([simpleRevision, advancedRevision]);
const correctionFields: Record<string, string> = {
  fullAddress: 'fullAddress',
  postalCode: 'postalCode',
  responseNote: 'responseNote',
};
const revisionFields: Record<string, string> = {
  period: 'period',
  totalKwh: 'totalKwh',
  giftCode: 'giftCode',
  startAt: 'startAt',
  endAt: 'endAt',
  'quantities.thermal': 'thermal',
  'quantities.green': 'green',
  'quantities.free_market': 'freeMarket',
  'quantities.energy_saving': 'energySaving',
  'address.provinceId': 'provinceId',
  'address.cityId': 'cityId',
  'address.fullAddress': 'fullAddress',
  'address.postalCode': 'postalCode',
  responseNote: 'responseNote',
};

/** A failed union may expose fields only from one unambiguous public form variant. */
function revisionFormSchema(body: unknown, confirmed: boolean): z.ZodType | undefined {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return;
  const simple = ['period', 'totalKwh'].some((key) => Object.hasOwn(body, key));
  const advanced = ['startAt', 'endAt', 'quantities'].some((key) => Object.hasOwn(body, key));
  if (simple === advanced) return;
  return simple
    ? confirmed
      ? simpleRevision
      : simpleRevisionPreview
    : confirmed
      ? advancedRevision
      : advancedRevisionPreview;
}

function parseCorrectionForm<S extends z.ZodType>(
  schema: S,
  body: unknown,
  fields: Record<string, string>,
  projection: z.ZodType | undefined = schema
): z.output<S> {
  const result = schema.safeParse(body);
  if (result.success) return result.data as z.output<S>;
  const projected = projection?.safeParse(body);
  const generic = () => new HttpException({ error: 'VALIDATION:INPUT_INVALID' }, 400);
  if (!projected || projected.success) throw generic();
  const owned: string[] = [];
  for (const issue of projected.error.issues) {
    const path = issue.path.join('.');
    if (
      !Object.hasOwn(fields, path) ||
      (!['invalid_type', 'too_small', 'too_big', 'invalid_format', 'invalid_value'].includes(
        issue.code
      ) &&
        !(issue.code === 'custom' && fields[path] === 'postalCode'))
    )
      throw generic();
    owned.push(fields[path]!);
  }
  if (!owned.length) throw generic();
  throw new InputFieldException(owned);
}
const cancelInput = z
  .object({
    idempotencyKey: z.string().uuid(),
    expectedVersionId: z.string().uuid(),
    expectedReviewHash: z.string().regex(/^[a-f0-9]{64}$/),
    reason: z.string().trim().min(1).max(1000),
  })
  .strict();
const cancelReviewInput = cancelInput.pick({ reason: true }).strict();

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
  @ApiResponse({ status: 200, description: 'Filtered electricity orders and next-page cursor.' })
  @ApiQuery({ name: 'status', required: false, enum: ['pending'] })
  @ApiQuery({
    name: 'statuses',
    required: false,
    type: String,
    description: 'CSV commercial statuses from the submitted order lifecycle',
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
    description: 'Literal order, invoice or contract reference substring, up to 120 characters',
  })
  @ApiQuery({ name: 'sort', required: false, enum: [...HISTORY_SORT_OPTIONS] })
  list(
    @Query('profileId', new ParseUUIDPipe()) profileId: string,
    @Query('before') before: string | undefined,
    @Query('status') status: string | undefined,
    @Req() req: AuthenticatedRequest,
    @Query('statuses') statuses?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('q') q?: string,
    @Query('sort') sort?: string
  ) {
    if (before && !z.string().uuid().safeParse(before).success)
      throw new HttpException({ error: 'VALIDATION:INPUT_INVALID' }, 400);
    if (status !== undefined && status !== 'pending')
      throw new HttpException({ error: 'VALIDATION:INPUT_INVALID' }, 400);
    const selectedStatuses = parseStatusFilter(statuses, ELECTRICITY_ORDER_STATUSES);
    const range = parseDateRangeFilter(from, to);
    const query = parseHistoryQuery(q, sort);
    if (!selectedStatuses || !range || !query)
      throw new HttpException({ error: 'VALIDATION:INPUT_INVALID' }, 400);
    return this.service.list(
      req.session,
      profileId,
      before,
      status,
      selectedStatuses,
      range,
      query
    );
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
    const parsed = parseCorrectionForm(addressCorrectionInput, body, correctionFields);
    return this.service.resubmitAddressCorrection(
      req.session,
      orderId,
      parsed,
      req.ip ?? 'unknown'
    );
  }

  @Post('orders/:orderId/revision-preview')
  @HttpCode(200)
  @RateLimit({ namespace: 'electricity:preview:user', limit: 60, windowMs: 60_000, scope: 'user' })
  @ApiOperation({ summary: 'Review current prices for a requested electricity order revision' })
  @ApiZodBody(revisionPreviewInput)
  revisionPreview(
    @Param('orderId', new ParseUUIDPipe()) orderId: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest
  ) {
    const parsed = parseCorrectionForm(
      revisionPreviewInput,
      body,
      revisionFields,
      revisionFormSchema(body, false)
    );
    return this.service.previewRevision(req.session, orderId, parsed);
  }

  @Post('orders/:orderId/resubmit')
  @HttpCode(200)
  @RateLimit({ namespace: 'electricity:order-revision:user', limit: 10, windowMs: 60_000 })
  @ApiOperation({ summary: 'Resubmit amended electricity terms with a replacement invoice' })
  @ApiZodBody(revisionInput)
  resubmitRevision(
    @Param('orderId', new ParseUUIDPipe()) orderId: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest
  ) {
    const parsed = parseCorrectionForm(
      revisionInput,
      body,
      revisionFields,
      revisionFormSchema(body, true)
    );
    return this.service.resubmitRevision(req.session, orderId, parsed, req.ip ?? 'unknown');
  }

  @Post('orders/:orderId/cancel-review')
  @HttpCode(200)
  @RateLimit({ namespace: 'electricity:order-cancel-review:user', limit: 30, windowMs: 60_000 })
  @ApiOperation({
    summary: 'Preview exact invoice and refund outcome of cancelling an electricity order',
  })
  @ApiZodBody(cancelReviewInput)
  @ApiResponse({ status: 200, description: 'Authoritative cancellation review.' })
  cancelReview(
    @Param('orderId', new ParseUUIDPipe()) orderId: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest
  ) {
    const parsed = cancelReviewInput.safeParse(body);
    if (!parsed.success) throw new HttpException({ error: 'VALIDATION:INPUT_INVALID' }, 400);
    return this.service.cancellationReview(req.session, orderId, parsed.data.reason);
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
  @RateLimit({ namespace: 'electricity:preview:user', limit: 60, windowMs: 60_000, scope: 'user' })
  @ApiOperation({ summary: 'Quote a simple electricity order using current authoritative prices' })
  @ApiZodBody(simpleInput)
  @ApiResponse({ status: 200, description: 'Current period, lines, discount, VAT and total.' })
  async preview(@Body() body: unknown, @Req() req: AuthenticatedRequest) {
    const parsed = simpleInput.safeParse(body);
    if (!parsed.success) throw new HttpException({ error: 'VALIDATION:INPUT_INVALID' }, 400);
    return this.service.preview(req.session, parsed.data);
  }

  @Post('orders/simple')
  @RequiresCapability('electricity_checkout')
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
  @RateLimit({ namespace: 'electricity:preview:user', limit: 60, windowMs: 60_000, scope: 'user' })
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
  @RequiresCapability('electricity_checkout')
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
