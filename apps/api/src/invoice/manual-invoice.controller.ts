import { Body, Controller, Get, HttpException, Post, Query, Req, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { z } from 'zod';
import { ErrorCodes } from '@barghsa/shared/errors';
import { SessionAuthGuard, type AuthenticatedRequest } from '../session/session.guard.js';
import { RequiresStepUp, StepUpGuard } from '../session/step-up.guard.js';
import { hasStaffPermission } from '../session/staff-permissions.js';
import { correlationIdStorage } from '../common/correlation-id.middleware.js';
import { ManualInvoiceService } from './manual-invoice.service.js';

const irr = z
  .string()
  .regex(/^\d{1,19}$/)
  .pipe(z.string().refine((value) => BigInt(value) <= 9_223_372_036_854_775_807n));
const inputSchema = z
  .object({
    profileId: z
      .string()
      .uuid()
      .transform((value) => value.toLowerCase()),
    contractId: z.string().trim().min(1).max(200).optional(),
    idempotencyKey: z.string().uuid(),
    lines: z
      .array(
        z
          .object({
            description: z.string().trim().min(1).max(1000),
            quantity: z.number().int().min(1).max(2_147_483_647),
            unitPrice: irr,
            vatRate: z.number().int().min(0).max(10_000),
            isTaxable: z.boolean(),
          })
          .strict()
      )
      .min(1)
      .max(100),
  })
  .strict();

@ApiTags('Admin · Manual invoices')
@ApiBearerAuth()
@UseGuards(SessionAuthGuard, StepUpGuard)
@Controller('api/admin/invoices/manual')
export class ManualInvoiceController {
  constructor(private readonly service: ManualInvoiceService) {}

  @Get('profiles')
  @ApiOperation({ summary: 'Find customer profiles eligible for a manual invoice' })
  @ApiQuery({ name: 'search', required: false, type: String, maxLength: 100 })
  @ApiResponse({ status: 200, description: 'Up to 50 active profile names and identifiers.' })
  async profiles(@Req() req: AuthenticatedRequest, @Query('search') search: unknown = '') {
    if (!hasStaffPermission(req, 'invoices:write'))
      throw new HttpException({ error: ErrorCodes.AUTHZ_FORBIDDEN.code }, 403);
    const parsed = z.string().trim().max(100).safeParse(search);
    if (!parsed.success)
      throw new HttpException({ error: ErrorCodes.VALIDATION_PARSE_ZOD.code }, 400);
    return this.service.profileOptions(req.session, parsed.data);
  }

  @Post()
  @RequiresStepUp()
  @ApiOperation({ summary: 'Create and issue a manual invoice for a customer profile' })
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['profileId', 'idempotencyKey', 'lines'],
      properties: {
        profileId: { type: 'string', format: 'uuid' },
        contractId: { type: 'string', minLength: 1, maxLength: 200 },
        idempotencyKey: { type: 'string', format: 'uuid' },
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
              quantity: { type: 'integer', minimum: 1, maximum: 2_147_483_647 },
              unitPrice: {
                type: 'string',
                pattern: '^\\d{1,19}$',
                description: 'Nonnegative int8 IRR, encoded as a decimal string.',
              },
              vatRate: {
                type: 'integer',
                minimum: 0,
                maximum: 10_000,
                description: 'VAT rate in basis points.',
              },
              isTaxable: { type: 'boolean' },
            },
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description:
      'Issued invoice. All IRR amounts are decimal strings. Identical retries return the same invoice.',
  })
  @ApiResponse({ status: 400, description: 'Invalid invoice lines or amounts.' })
  @ApiResponse({
    status: 403,
    description: 'Current invoice-write permission, CSRF and step-up required.',
  })
  @ApiResponse({
    status: 409,
    description: 'Archived profile or request key reused for another payload.',
  })
  async create(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    if (!hasStaffPermission(req, 'invoices:write'))
      throw new HttpException({ error: ErrorCodes.AUTHZ_FORBIDDEN.code }, 403);
    const parsed = inputSchema.safeParse(body);
    if (!parsed.success)
      throw new HttpException(
        { error: ErrorCodes.VALIDATION_PARSE_ZOD.code, details: parsed.error.flatten() },
        400
      );
    const correlationId = correlationIdStorage.getStore();
    const invoice = await this.service.createManualInvoice({
      profileId: parsed.data.profileId,
      idempotencyKey: parsed.data.idempotencyKey,
      ...(parsed.data.contractId !== undefined ? { contractId: parsed.data.contractId } : {}),
      lines: parsed.data.lines.map((line) => ({ ...line, unitPrice: BigInt(line.unitPrice) })),
      actorUserId: req.session.userId,
      actorSession: req.session,
      ip: req.ip ?? req.socket?.remoteAddress ?? 'unknown',
      ...(correlationId ? { correlationId } : {}),
    });
    return {
      invoiceId: invoice.invoiceId,
      profileId: invoice.profileId,
      contractId: invoice.contractId,
      state: invoice.state,
      totalAmount: invoice.totalAmount.toString(),
      issuedAt: invoice.issuedAt.toISOString(),
      payableFrom: invoice.payableFrom.toISOString(),
      dueAt: invoice.dueAt?.toISOString() ?? null,
      lines: invoice.lines.map((line) => ({
        ...line,
        unitPrice: line.unitPrice.toString(),
        lineTotal: line.lineTotal.toString(),
        vatAmount: line.vatAmount.toString(),
      })),
    };
  }
}
