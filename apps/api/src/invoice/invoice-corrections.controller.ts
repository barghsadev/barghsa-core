import {
  Body,
  Controller,
  Get,
  HttpException,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { z } from 'zod';
import { ErrorCodes } from '@barghsa/shared/errors';
import { SessionAuthGuard, type AuthenticatedRequest } from '../session/session.guard.js';
import { RequiresStepUp, StepUpGuard } from '../session/step-up.guard.js';
import { hasStaffPermission } from '../session/staff-permissions.js';
import { correlationIdStorage } from '../common/correlation-id.middleware.js';
import { CancelAndReplaceInvoiceService } from './cancel-and-replace-invoice.service.js';
import { InvoiceAdjustmentApprovalService } from './invoice-adjustment-approval.service.js';
import { invoiceCorrectionContext } from './invoice-correction-request.js';

const maxIrr = 9_223_372_036_854_775_807n;
const base = {
  idempotencyKey: z
    .string()
    .uuid()
    .transform((v) => v.toLowerCase()),
  reason: z.string().trim().min(1).max(1000),
};
const line = z
  .object({
    description: z.string().trim().min(1).max(1000),
    quantity: z.number().int().min(1).max(2_147_483_647),
    unitPrice: z
      .string()
      .regex(/^\d{1,19}$/)
      .pipe(z.string().refine((v) => BigInt(v) <= maxIrr)),
    vatRate: z.number().int().min(0).max(10_000),
    isTaxable: z.boolean(),
  })
  .strict();
const input = z.discriminatedUnion('kind', [
  z
    .object({ ...base, kind: z.literal('replacement'), lines: z.array(line).min(1).max(100) })
    .strict(),
  z
    .object({
      ...base,
      kind: z.literal('adjustment'),
      amount: z
        .string()
        .regex(/^-?\d{1,19}$/)
        .pipe(
          z.string().refine((v) => BigInt(v) !== 0n && BigInt(v) >= -maxIrr && BigInt(v) <= maxIrr)
        ),
    })
    .strict(),
]);

@ApiTags('Admin · Invoice corrections')
@ApiBearerAuth()
@ApiParam({ name: 'invoiceId', type: String, format: 'uuid' })
@UseGuards(SessionAuthGuard, StepUpGuard)
@Controller('api/admin/invoices/:invoiceId/corrections')
export class InvoiceCorrectionsController {
  constructor(
    private readonly replacements: CancelAndReplaceInvoiceService,
    private readonly adjustments: InvoiceAdjustmentApprovalService
  ) {}

  private invoiceId(req: AuthenticatedRequest, value: string) {
    if (!hasStaffPermission(req, 'invoices:write'))
      throw new HttpException({ error: ErrorCodes.AUTHZ_FORBIDDEN.code }, 403);
    const parsed = z.string().uuid().safeParse(value);
    if (!parsed.success)
      throw new HttpException({ error: ErrorCodes.VALIDATION_PARSE_ZOD.code }, 400);
    return parsed.data.toLowerCase();
  }

  @Get()
  @ApiOperation({ summary: 'Read an invoice and immutable source lines for staff correction' })
  @ApiResponse({
    status: 200,
    description:
      'Current source invoice, profile, state, paid amount, total and source lines. IRR decimal strings.',
  })
  async context(@Req() req: AuthenticatedRequest, @Param('invoiceId') value: string) {
    return invoiceCorrectionContext(this.invoiceId(req, value), req.session);
  }

  @Post()
  @RequiresStepUp()
  @ApiOperation({
    summary: 'Cancel and replace before payment, or create a signed adjustment after payment',
  })
  @ApiBody({
    schema: {
      oneOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'idempotencyKey', 'reason', 'lines'],
          properties: {
            kind: { type: 'string', enum: ['replacement'] },
            idempotencyKey: { type: 'string', format: 'uuid' },
            reason: { type: 'string', minLength: 1, maxLength: 1000 },
            lines: {
              type: 'array',
              minItems: 1,
              maxItems: 100,
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['description', 'quantity', 'unitPrice', 'vatRate', 'isTaxable'],
                properties: {
                  description: { type: 'string', minLength: 1, maxLength: 1000 },
                  quantity: { type: 'integer', minimum: 1, maximum: 2147483647 },
                  unitPrice: {
                    type: 'string',
                    pattern: '^\\d{1,19}$',
                    description: 'Nonnegative int8 IRR',
                  },
                  vatRate: { type: 'integer', minimum: 0, maximum: 10000 },
                  isTaxable: { type: 'boolean' },
                },
              },
            },
          },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'idempotencyKey', 'reason', 'amount'],
          properties: {
            kind: { type: 'string', enum: ['adjustment'] },
            idempotencyKey: { type: 'string', format: 'uuid' },
            reason: { type: 'string', minLength: 1, maxLength: 1000 },
            amount: {
              type: 'string',
              pattern: '^-?\\d{1,19}$',
              description:
                'Nonzero signed IRR; absolute value must fit int8. Positive charge, negative credit note. Does not transfer wallet funds.',
            },
          },
        },
      ],
    },
  })
  @ApiResponse({
    status: 201,
    description:
      'Linked correction; amounts are decimal strings. Same request key and payload replay the existing correction.',
  })
  @ApiResponse({ status: 400, description: 'Invalid request or unsupported int8 total.' })
  @ApiResponse({
    status: 202,
    description:
      'Adjustment awaits a different financial reviewer. No correction invoice exists yet. Returns approvalRequestId and the exact submitted request.',
  })
  @ApiResponse({
    status: 403,
    description: 'Current Finance permission, CSRF and fresh step-up required through commit.',
  })
  @ApiResponse({
    status: 409,
    description: 'Invalid source state, archived profile, or request-key payload conflict.',
  })
  async create(
    @Req() req: AuthenticatedRequest,
    @Param('invoiceId') value: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response
  ) {
    const invoiceId = this.invoiceId(req, value);
    const parsed = input.safeParse(body);
    if (!parsed.success)
      throw new HttpException({ error: ErrorCodes.VALIDATION_PARSE_ZOD.code }, 400);
    const data = parsed.data;
    const correlationId = correlationIdStorage.getStore();
    const common = {
      reason: data.reason,
      idempotencyKey: data.idempotencyKey,
      actorUserId: req.session.userId,
      actorSession: req.session,
      ip: req.ip ?? 'unknown',
      ...(correlationId ? { correlationId } : {}),
    };
    const result =
      data.kind === 'replacement'
        ? await this.replacements.cancelAndReplaceInvoice({
            ...common,
            invoiceId,
            newLines: data.lines.map((l) => ({ ...l, unitPrice: BigInt(l.unitPrice) })),
          })
        : await this.adjustments.submit({
            ...common,
            originalInvoiceId: invoiceId,
            amount: BigInt(data.amount),
          });
    if ('status' in result) {
      response.status(202);
      return result;
    }
    return {
      originalInvoiceId: invoiceId,
      invoiceId:
        'replacementInvoiceId' in result ? result.replacementInvoiceId : result.adjustmentInvoiceId,
      profileId: result.profileId,
      kind: data.kind,
      idempotencyKey: data.idempotencyKey,
      reason: data.reason,
      amount: ('amount' in result ? result.amount : result.totalAmount).toString(),
      totalAmount: result.totalAmount.toString(),
      issuedAt: result.issuedAt.toISOString(),
      dueAt: result.dueAt?.toISOString() ?? null,
      payableFrom: result.payableFrom?.toISOString() ?? null,
      lines: result.lines.map((l) => ({
        ...l,
        unitPrice: l.unitPrice.toString(),
        lineTotal: l.lineTotal.toString(),
        vatAmount: l.vatAmount.toString(),
      })),
    };
  }
}
