import { throwReceiptFieldErrors } from '../finance/receipt-input-fields.js';
/**
 * Customer invoice API (T-04.1.05.04 / T-04.3.01.02).
 *
 * Authenticated customers read invoices for their active profile:
 *   GET  /api/invoices                           → list (non-draft)
 *   GET  /api/invoices/:invoiceId                → details + correction chain
 *   POST /api/invoices/:invoiceId/bank-receipts  → submit a receipt (Submitted)
 *
 * Details include the original invoice and every linked replacement or
 * adjustment, each with the staff-supplied explanation of the change.
 * Receipt upload validates amount, file type/size, and inserts a
 * Submitted bank_receipts row without settling the invoice.
 */

import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Query,
  Redirect,
  StreamableFile,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { z } from 'zod';
import { ErrorCodes } from '@barghsa/shared/errors';
import {
  CUSTOMER_INVOICE_STATUSES,
  BANK_RECEIPT_STATUSES,
  parseStatusFilter,
  parseDateRangeFilter,
  parseInvoiceListQuery,
  parseHistoryQuery,
  HISTORY_SORT_OPTIONS,
  parseNumberRange,
} from '@barghsa/shared/validation';
import { SessionAuthGuard, type AuthenticatedRequest } from '../session/session.guard.js';
import { RateLimit } from '../rate-limit/rate-limit.decorator.js';
import {
  CustomerInvoiceDetailsService,
  type CustomerInvoiceDetailsDto,
  type CustomerInvoiceListDto,
} from './customer-invoice-details.service.js';
import { InvoiceBankReceiptUploadService } from './invoice-bank-receipt-upload.service.js';

const InvoiceBankReceiptFieldsSchema = z.object({
  amount: z.union([z.number(), z.string()]),
  paymentDate: z.string().min(1),
  payerReference: z.string().min(1),
  bankName: z.string().max(128).optional(),
  attachmentKey: z.string().min(1),
  customerNote: z.string().optional(),
});
const InvoiceBankReceiptReviewBodySchema = InvoiceBankReceiptFieldsSchema.strict();
const InvoiceBankReceiptBodySchema = InvoiceBankReceiptFieldsSchema.extend({
  expectedReviewHash: z.string().regex(/^[0-9a-f]{64}$/),
}).strict();

const BankReceiptListQuerySchema = z
  .object({
    state: z.enum(BANK_RECEIPT_STATUSES).optional(),
    statuses: z
      .string()
      .refine((value) => parseStatusFilter(value, BANK_RECEIPT_STATUSES) !== null)
      .optional(),
    q: z.string().optional(),
    sort: z.enum(HISTORY_SORT_OPTIONS).optional(),
    from: z.string().optional(),
    to: z.string().optional(),
    min: z.string().optional(),
    max: z.string().optional(),
    beforeAt: z.string().datetime({ offset: true }).optional(),
    beforeId: z.string().uuid().optional(),
  })
  .strict()
  .refine((query) => (query.beforeAt === undefined) === (query.beforeId === undefined))
  .refine((query) => query.state === undefined || query.statuses === undefined);

export interface InvoiceBankReceiptResponse {
  ok: true;
  receiptId: string;
  invoiceId: string;
  amount: string;
  currency: 'IRR';
  state: 'Submitted';
  paymentDate: string;
  payerReference: string;
  bankName: string | null;
  attachmentKey: string;
}

function httpError(code: string, message: string, statusCode = 400): never {
  throw new HttpException({ statusCode, error: code, message }, statusCode);
}

function assertUuid(id: string, label = 'invoiceId'): void {
  const parsed = z.string().uuid('Expected a UUID').safeParse(id);
  if (!parsed.success) {
    httpError(
      ErrorCodes.VALIDATION_PARSE_ZOD.code,
      `Invalid ${label}: expected a UUID`,
      HttpStatus.BAD_REQUEST
    );
  }
}

@ApiTags('Invoices')
@ApiBearerAuth()
@UseGuards(SessionAuthGuard)
@Controller('api/invoices')
export class CustomerInvoiceController {
  constructor(
    private readonly service: CustomerInvoiceDetailsService,
    private readonly bankReceiptUpload: InvoiceBankReceiptUploadService
  ) {}

  @Get()
  @RateLimit({ namespace: 'invoices:list:user', limit: 60, windowMs: 60_000 })
  @ApiOperation({
    summary: 'List invoices for the active profile',
    description:
      "Returns up to 50 non-draft invoices on the caller's active profile with a nextBefore cursor. Filters combine before pagination; amounts are inclusive exact IRR integers. Dates filter creation time, from inclusive and to exclusive.",
  })
  @ApiResponse({ status: 200, description: 'Invoice list for the active profile.' })
  @ApiQuery({ name: 'status', required: false, enum: ['unpaid'] })
  @ApiQuery({
    name: 'statuses',
    required: false,
    description: 'Comma-separated customer invoice states',
  })
  @ApiQuery({
    name: 'from',
    required: false,
    description: 'Inclusive creation timestamp (UTC ISO)',
  })
  @ApiQuery({ name: 'to', required: false, description: 'Exclusive creation timestamp (UTC ISO)' })
  @ApiQuery({
    name: 'q',
    required: false,
    description: 'Literal invoice reference substring, up to 120 characters',
  })
  @ApiQuery({ name: 'sort', required: false, enum: ['created_at:desc', 'created_at:asc'] })
  @ApiQuery({ name: 'min', required: false, description: 'Inclusive minimum total amount in IRR' })
  @ApiQuery({ name: 'max', required: false, description: 'Inclusive maximum total amount in IRR' })
  @ApiQuery({ name: 'before', required: false, format: 'uuid' })
  @ApiResponse({ status: 400, description: 'Invalid filter or cursor' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 404, description: 'No active profile' })
  async list(
    @Req() req: AuthenticatedRequest,
    @Query('status') status?: string,
    @Query() raw: Record<string, unknown> = {}
  ): Promise<CustomerInvoiceListDto> {
    if (status !== undefined && status !== 'unpaid')
      httpError(ErrorCodes.VALIDATION_INPUT_INVALID.code, 'Invalid invoice status filter');
    const statuses = parseStatusFilter(raw.statuses, CUSTOMER_INVOICE_STATUSES);
    const dates = parseDateRangeFilter(raw.from, raw.to);
    const query = parseInvoiceListQuery(raw.q, raw.sort);
    const amounts = parseNumberRange(raw.min, raw.max);
    if (!statuses || !dates || !query || !amounts)
      httpError(ErrorCodes.VALIDATION_INPUT_INVALID.code, 'Invalid invoice filter');
    if (raw.before !== undefined && typeof raw.before !== 'string')
      httpError(ErrorCodes.VALIDATION_INPUT_INVALID.code, 'Invalid invoice cursor');
    if (raw.before !== undefined) assertUuid(raw.before as string, 'before');
    return this.service.listForUser(req.session.userId, req.session, status === 'unpaid', {
      ...query,
      ...dates,
      ...amounts,
      statuses,
      ...(raw.before === undefined ? {} : { before: raw.before as string }),
    });
  }

  @Get('bank-receipts')
  @RateLimit({ namespace: 'invoices:receipt-list:user', limit: 60, windowMs: 60_000 })
  @ApiOperation({ summary: 'List bank receipts across invoices on the active profile' })
  @ApiQuery({
    name: 'state',
    required: false,
    enum: ['Submitted', 'UnderReview', 'Confirmed', 'Rejected'],
  })
  @ApiQuery({
    name: 'beforeAt',
    required: false,
    description: 'Cursor timestamp from the previous page',
  })
  @ApiQuery({ name: 'beforeId', required: false, format: 'uuid' })
  @ApiQuery({
    name: 'statuses',
    required: false,
    description:
      'Comma-separated Submitted, UnderReview, Confirmed or Rejected states. Cannot be combined with state.',
  })
  @ApiQuery({
    name: 'q',
    required: false,
    description:
      'Literal receipt/invoice ID, bank name or payer reference substring, up to 120 characters',
  })
  @ApiQuery({ name: 'sort', required: false, enum: HISTORY_SORT_OPTIONS })
  @ApiQuery({ name: 'from', required: false, description: 'Inclusive submission timestamp' })
  @ApiQuery({ name: 'to', required: false, description: 'Exclusive submission timestamp' })
  @ApiQuery({
    name: 'min',
    required: false,
    description: 'Inclusive minimum receipt amount in IRR',
  })
  @ApiQuery({
    name: 'max',
    required: false,
    description: 'Inclusive maximum receipt amount in IRR',
  })
  @ApiResponse({
    status: 200,
    description:
      'Up to 25 receipts in the selected submission order and a cursor for the next page.',
  })
  @ApiResponse({ status: 400, description: 'Invalid state or cursor.' })
  @ApiResponse({ status: 404, description: 'No active profile.' })
  listBankReceipts(@Req() req: AuthenticatedRequest, @Query() rawQuery: unknown) {
    const parsed = BankReceiptListQuerySchema.safeParse(rawQuery);
    if (!parsed.success)
      httpError(ErrorCodes.VALIDATION_INPUT_INVALID.code, 'Invalid receipt list filter');
    const query = parseHistoryQuery(parsed.data.q, parsed.data.sort);
    const dates = parseDateRangeFilter(parsed.data.from, parsed.data.to);
    const amounts = parseNumberRange(parsed.data.min, parsed.data.max);
    if (!query || !dates || !amounts)
      httpError(ErrorCodes.VALIDATION_INPUT_INVALID.code, 'Invalid receipt list filter');
    return this.service.listBankReceiptsForUser(req.session.userId, req.session, {
      ...query,
      ...dates,
      ...amounts,
      beforeAt: parsed.data.beforeAt,
      beforeId: parsed.data.beforeId,
      statuses: parsed.data.state
        ? [parsed.data.state]
        : parseStatusFilter(parsed.data.statuses, BANK_RECEIPT_STATUSES)!,
    });
  }

  @Get(':invoiceId')
  @RateLimit({ namespace: 'invoices:get:user', limit: 60, windowMs: 60_000 })
  @ApiOperation({
    summary: 'Get invoice details with the correction chain',
    description:
      'Returns the requested invoice plus the original and every linked ' +
      'replacement or adjustment, each with a customer-visible explanation.',
  })
  @ApiParam({ name: 'invoiceId', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Invoice details and correction chain.' })
  @ApiResponse({ status: 400, description: 'invoiceId is not a UUID' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 404, description: 'Invoice not found for the active profile' })
  async get(
    @Req() req: AuthenticatedRequest,
    @Param('invoiceId') invoiceId: string
  ): Promise<CustomerInvoiceDetailsDto> {
    assertUuid(invoiceId);
    return this.service.getForUser(req.session.userId, invoiceId, req.session);
  }

  @Get(':invoiceId/bank-receipts/:receiptId/preview')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  @RateLimit({ namespace: 'invoices:receipt-preview:user', limit: 30, windowMs: 60_000 })
  @ApiOperation({ summary: 'Preview a receipt image or first PDF page on the active profile' })
  @ApiParam({ name: 'invoiceId', format: 'uuid' })
  @ApiParam({ name: 'receiptId', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Bounded PNG preview.',
    content: { 'image/png': { schema: { type: 'string', format: 'binary' } } },
  })
  @ApiResponse({ status: 400, description: 'Invalid invoice or receipt ID.' })
  @ApiResponse({ status: 401, description: 'Not authenticated.' })
  @ApiResponse({ status: 404, description: 'Invoice or receipt unavailable on this profile.' })
  @ApiResponse({ status: 503, description: 'Preview cannot be generated.' })
  async receiptPreview(
    @Req() req: AuthenticatedRequest,
    @Param('invoiceId') invoiceId: string,
    @Param('receiptId') receiptId: string
  ) {
    assertUuid(invoiceId);
    assertUuid(receiptId, 'receiptId');
    const bytes = await this.service.receiptPreviewForUser(
      req.session.userId,
      invoiceId,
      receiptId,
      req.session
    );
    return new StreamableFile(bytes, {
      type: 'image/png',
      disposition: 'inline',
      length: bytes.length,
    });
  }

  @Get(':invoiceId/bank-receipts/:receiptId/attachment')
  @Redirect('', 302)
  @Header('Cache-Control', 'no-store')
  @Header('Referrer-Policy', 'no-referrer')
  @RateLimit({ namespace: 'invoices:receipt-attachment:user', limit: 30, windowMs: 60_000 })
  @ApiOperation({ summary: 'Open a receipt attachment on an invoice for the active profile' })
  @ApiParam({ name: 'invoiceId', format: 'uuid' })
  @ApiParam({ name: 'receiptId', format: 'uuid' })
  @ApiResponse({ status: 302, description: 'Redirects to a short-lived attachment URL.' })
  @ApiResponse({ status: 400, description: 'Invoice or receipt ID is invalid.' })
  @ApiResponse({ status: 401, description: 'Not authenticated.' })
  @ApiResponse({ status: 404, description: 'Invoice or receipt unavailable on this profile.' })
  @ApiResponse({ status: 503, description: 'Receipt storage is unavailable.' })
  async receiptAttachment(
    @Req() req: AuthenticatedRequest,
    @Param('invoiceId') invoiceId: string,
    @Param('receiptId') receiptId: string
  ): Promise<{ url: string }> {
    assertUuid(invoiceId);
    assertUuid(receiptId, 'receiptId');
    return {
      url: await this.service.receiptAttachmentUrlForUser(
        req.session.userId,
        invoiceId,
        receiptId,
        req.session
      ),
    };
  }

  @Post(':invoiceId/bank-receipts/review')
  @HttpCode(200)
  @RateLimit({
    namespace: 'invoices:bank-receipt-review:user',
    scope: 'user',
    limit: 30,
    windowMs: 60_000,
  })
  @ApiOperation({ summary: 'Review an invoice bank receipt before submission' })
  @ApiParam({ name: 'invoiceId', format: 'uuid' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['amount', 'paymentDate', 'payerReference', 'attachmentKey'],
      properties: {
        amount: { oneOf: [{ type: 'string' }, { type: 'number' }] },
        paymentDate: { type: 'string', format: 'date' },
        payerReference: { type: 'string' },
        bankName: { type: 'string', maxLength: 128 },
        attachmentKey: { type: 'string' },
        customerNote: { type: 'string' },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Server-confirmed invoice and receipt snapshot.' })
  async reviewBankReceipt(
    @Req() req: AuthenticatedRequest,
    @Param('invoiceId') invoiceId: string,
    @Body() rawBody: unknown
  ) {
    assertUuid(invoiceId);
    const parsed = InvoiceBankReceiptReviewBodySchema.safeParse(rawBody ?? {});
    if (!parsed.success) {
      throwReceiptFieldErrors(parsed.error.issues);
      httpError(ErrorCodes.VALIDATION_PARSE_ZOD.code, 'Bank receipt review fields are required');
    }
    return this.bankReceiptUpload.review({
      userId: req.session.userId,
      sessionId: req.session.sessionId,
      csrfToken: req.session.csrfToken,
      invoiceId,
      ...parsed.data,
    });
  }

  /** Submit a reviewed receipt in Submitted; settlement waits for staff confirmation. */
  @Post(':invoiceId/bank-receipts')
  @HttpCode(201)
  @RateLimit({ namespace: 'invoices:bank-receipt:user', limit: 10, windowMs: 60_000 })
  @ApiOperation({
    summary: 'Submit a bank receipt against an invoice (Submitted until staff confirm)',
  })
  @ApiParam({ name: 'invoiceId', format: 'uuid' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['amount', 'paymentDate', 'payerReference', 'attachmentKey', 'expectedReviewHash'],
      properties: {
        amount: { oneOf: [{ type: 'string' }, { type: 'number' }] },
        paymentDate: { type: 'string', format: 'date' },
        payerReference: { type: 'string' },
        bankName: { type: 'string', maxLength: 128, description: 'Optional bank name on the slip' },
        attachmentKey: { type: 'string' },
        customerNote: { type: 'string' },
        expectedReviewHash: { type: 'string', pattern: '^[0-9a-f]{64}$' },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'Submitted bank receipt created; invoice unchanged.' })
  @ApiResponse({ status: 400, description: 'Invalid amount, date, payer reference, or file' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 404, description: 'Invoice not found for the active profile' })
  @ApiResponse({
    status: 409,
    description: 'Invoice cannot receive a receipt, or attachment reused',
  })
  async submitBankReceipt(
    @Req() req: AuthenticatedRequest,
    @Param('invoiceId') invoiceId: string,
    @Body() rawBody: unknown
  ): Promise<InvoiceBankReceiptResponse> {
    assertUuid(invoiceId);
    const parsed = InvoiceBankReceiptBodySchema.safeParse(rawBody ?? {});
    if (!parsed.success) {
      throwReceiptFieldErrors(parsed.error.issues);
      httpError(
        ErrorCodes.VALIDATION_PARSE_ZOD.code,
        'Bank receipt body must include receipt details and expectedReviewHash',
        HttpStatus.BAD_REQUEST
      );
    }

    const result = await this.bankReceiptUpload.submit({
      userId: req.session.userId,
      sessionId: req.session.sessionId,
      csrfToken: req.session.csrfToken,
      invoiceId,
      amount: parsed.data.amount,
      paymentDate: parsed.data.paymentDate,
      payerReference: parsed.data.payerReference,
      bankName: parsed.data.bankName,
      attachmentKey: parsed.data.attachmentKey,
      customerNote: parsed.data.customerNote,
      expectedReviewHash: parsed.data.expectedReviewHash,
    });

    return {
      ok: true,
      receiptId: result.receiptId,
      invoiceId: result.invoiceId,
      amount: result.amount.toString(),
      currency: 'IRR',
      state: result.state,
      paymentDate: result.paymentDate,
      payerReference: result.payerReference,
      bankName: result.bankName,
      attachmentKey: result.attachmentKey,
    };
  }
}
