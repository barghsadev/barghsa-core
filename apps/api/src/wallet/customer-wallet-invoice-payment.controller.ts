import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
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
import { correlationIdStorage } from '../common/correlation-id.middleware.js';
import { CustomerWalletInvoicePaymentService } from './customer-wallet-invoice-payment.service.js';

const bodySchema = z
  .object({
    idempotencyKey: z
      .string()
      .uuid()
      .transform((v) => v.toLowerCase()),
    expectedRemainingAmount: z
      .string()
      .regex(/^[1-9]\d{0,18}$/)
      .pipe(z.string().refine((v) => BigInt(v) <= 9_223_372_036_854_775_807n)),
  })
  .strict();
@ApiTags('Invoices')
@ApiBearerAuth()
@ApiParam({ name: 'invoiceId', format: 'uuid' })
@UseGuards(SessionAuthGuard, StepUpGuard)
@Controller('api/invoices/:invoiceId/wallet-payment')
export class CustomerWalletInvoicePaymentController {
  constructor(private readonly service: CustomerWalletInvoicePaymentService) {}
  private id(value: string) {
    const parsed = z.string().uuid().safeParse(value);
    if (!parsed.success)
      throw new HttpException({ error: ErrorCodes.VALIDATION_PARSE_ZOD.code }, 400);
    return parsed.data.toLowerCase();
  }

  @Get()
  @ApiOperation({
    summary:
      'Review remaining invoice amount and available wallet balance for the active owner profile',
  })
  @ApiResponse({
    status: 200,
    description:
      'invoiceId, profileId, remainingAmount and availableBalance as exact IRR strings, and canPay.',
  })
  @ApiResponse({
    status: 404,
    description: 'Invoice or wallet-debit authority unavailable on the active profile.',
  })
  context(@Req() req: AuthenticatedRequest, @Param('invoiceId') invoiceId: string) {
    return this.service.context(req.session, this.id(invoiceId));
  }

  @Post()
  @HttpCode(200)
  @RequiresStepUp()
  @ApiOperation({
    summary: 'Pay the confirmed remaining invoice amount in one atomic wallet debit',
  })
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['idempotencyKey', 'expectedRemainingAmount'],
      properties: {
        idempotencyKey: { type: 'string', format: 'uuid' },
        expectedRemainingAmount: {
          type: 'string',
          pattern: '^[1-9]\\d{0,18}$',
          description:
            'Positive int8 IRR remaining amount shown at confirmation. Changes require a new review.',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description:
      'Exact invoice/profile/key, Paid state, signed-independent positive amount string, walletTransactionId and auditId. Safe retry returns the original result.',
  })
  @ApiResponse({
    status: 403,
    description:
      'Current session, CSRF, wallet-debit authority and fresh verification are required through commit.',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid input, insufficient available funds or an unpayable invoice.',
  })
  @ApiResponse({
    status: 409,
    description: 'Confirmed amount changed or request-key conflict.',
  })
  pay(
    @Req() req: AuthenticatedRequest,
    @Param('invoiceId') invoiceId: string,
    @Body() body: unknown
  ) {
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success)
      throw new HttpException({ error: ErrorCodes.VALIDATION_PARSE_ZOD.code }, 400);
    return this.service.pay(
      req.session,
      this.id(invoiceId),
      parsed.data.idempotencyKey,
      BigInt(parsed.data.expectedRemainingAmount),
      req.ip ?? 'unknown',
      correlationIdStorage.getStore()
    );
  }
}
