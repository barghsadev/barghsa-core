import type { AgentPermission } from '@barghsa/shared/agent-permissions';
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpException,
  Logger,
  NotFoundException,
  Param,
  Post,
  Req,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { z } from 'zod';
import { ErrorCodes } from '@barghsa/shared/errors';
import { parseOnlineTopUpAmountIrR } from '@barghsa/shared/finance';
import { SessionAuthGuard } from '../session/session.guard.js';
import type { AuthenticatedRequest } from '../session/session.guard.js';
import { RateLimit } from '../rate-limit/rate-limit.decorator.js';
import { WalletService } from './wallet.service.js';
import { ProfilesService } from '../profiles/profiles.service.js';
import { OnlineTopUpService } from './online-topup.service.js';
import { BankReceiptTopUpService } from './bank-receipt-topup.service.js';
import { parseWalletHistoryQuery, readWalletHistory } from './wallet-history.js';
import { activeProfileSql } from '../profiles/profile-context.js';
import { withCustomerWalletAccess } from './customer-wallet-access.js';
import { RequiresCapability } from '../maintenance/maintenance.guard.js';

const InitiateBodySchema = z
  .object({
    amount: z.union([z.number(), z.string()]),
    idempotencyKey: z.string().min(1).optional(),
  })
  .strict();

const BankReceiptBodySchema = z
  .object({
    amount: z.union([z.number(), z.string()]),
    paymentDate: z.string().min(1),
    payerReference: z.string().min(1),
    attachmentKey: z.string().min(1),
    customerNote: z.string().optional(),
    idempotencyKey: z.string().min(1).optional(),
  })
  .strict();

@ApiTags('Wallet')
@ApiBearerAuth()
@UseGuards(SessionAuthGuard)
@Controller('api/wallet')
export class WalletController {
  private readonly logger = new Logger(WalletController.name);

  constructor(
    private readonly walletService: WalletService,
    private readonly profilesService: ProfilesService,
    private readonly onlineTopUpService: OnlineTopUpService,
    private readonly bankReceiptTopUpService: BankReceiptTopUpService
  ) {}

  /**
   * Verify that the authenticated user has access to the given profile.
   * Throws NotFoundException if the profile doesn't belong to the user.
   */
  private async assertProfileAccess(
    req: AuthenticatedRequest,
    profileId: string,
    permission: AgentPermission = 'wallet:view'
  ): Promise<void> {
    const profile = await this.profilesService.getAccessibleProfile(
      req.session.userId,
      profileId,
      permission
    );
    if (!profile) {
      throw new NotFoundException(`Profile ${profileId} not found or not accessible`);
    }
  }

  @Get(':profileId')
  @ApiOperation({ summary: 'Get wallet balance for a profile' })
  async getWallet(@Param('profileId') profileId: string, @Req() req: AuthenticatedRequest) {
    assertUuid(profileId, 'profileId');
    return withCustomerWalletAccess(req.session, profileId, 'wallet:view', async (client) => {
      this.logger.debug(`Wallet inquiry: user=${req.session.userId} profile=${profileId}`);
      const wallet = await this.walletService.getWallet(profileId, client);
      const limit = await this.walletService.resolveOnlineTopUpLimit();
      const limitFields =
        limit === null
          ? {}
          : {
              onlineTopUpLimit: limit.onlineTopUpLimit,
              configVersion: limit.configVersion,
            };
      if (!wallet) {
        return {
          balance: '0',
          currency: 'IRR',
          ...limitFields,
        };
      }
      return {
        balance: wallet.availableBalance.toString(),
        postedBalance: wallet.postedBalance.toString(),
        reservedBalance: wallet.reservedBalance.toString(),
        currency: 'IRR',
        ...limitFields,
      };
    });
  }

  @Post(':profileId/create')
  @ApiOperation({ summary: 'Create wallet for a profile' })
  async createWallet(@Param('profileId') profileId: string, @Req() req: AuthenticatedRequest) {
    assertUuid(profileId, 'profileId');
    await this.assertProfileAccess(req, profileId, 'wallet:charge');
    return withCustomerWalletAccess(req.session, profileId, 'wallet:charge', async (client) => {
      this.logger.debug(`Wallet creation: user=${req.session.userId} profile=${profileId}`);
      const wallet = await this.walletService.createWallet(profileId, client);
      return {
        ok: true,
        balance: wallet.availableBalance.toString(),
        currency: 'IRR',
      };
    });
  }

  /**
   * POST /api/wallet/:profileId/top-ups
   *
   * Online top-up initiation (T-04.2.02.01): validate the per-transaction
   * limit, insert a Pending ledger row, and return the payment-gateway
   * redirect URL. The wallet is not credited here.
   */
  @Post(':profileId/top-ups')
  @RequiresCapability('wallet_topup')
  @HttpCode(201)
  @RateLimit({ namespace: 'wallet:top-up:user', limit: 10, windowMs: 60_000 })
  @ApiOperation({ summary: 'Start an online wallet top-up and redirect to the payment gateway' })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiResponse({
    status: 201,
    description: 'Pending top-up created; client must redirect to redirectUrl.',
  })
  @ApiResponse({ status: 400, description: 'Invalid amount or over the configured limit' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 404, description: 'Profile not found or not accessible' })
  @ApiResponse({
    status: 409,
    description: 'Idempotency key already used for a different operation',
  })
  async initiateOnlineTopUp(
    @Param('profileId') profileId: string,
    @Body() rawBody: unknown,
    @Headers('idempotency-key') idempotencyHeader: string | undefined,
    @Req() req: AuthenticatedRequest
  ) {
    assertUuid(profileId, 'profileId');
    await this.assertProfileAccess(req, profileId, 'wallet:charge');

    const parsed = InitiateBodySchema.safeParse(rawBody ?? {});
    if (!parsed.success) {
      httpError(
        ErrorCodes.VALIDATION_PARSE_ZOD,
        'Online top-up body must include a numeric amount'
      );
    }

    const amountIrR = parseOnlineTopUpAmountIrR(parsed.data.amount);
    if (amountIrR === null) {
      httpError(
        ErrorCodes.VALIDATION_INPUT_INVALID,
        'Online top-up amount must be a positive integer IRR value'
      );
    }

    const idempotencyKey = (idempotencyHeader ?? parsed.data.idempotencyKey ?? '').trim();
    if (!idempotencyKey) {
      httpError(
        ErrorCodes.VALIDATION_INPUT_MISSING,
        'Idempotency-Key header (or idempotencyKey in the body) is required'
      );
    }

    const result = await this.onlineTopUpService.initiate({
      actor: req.session,
      profileId,
      amountIrR,
      idempotencyKey,
    });

    this.logger.log(
      `Online top-up ${result.transactionId} initiated for profile ${profileId} by user ${req.session.userId}`
    );

    return {
      ok: true,
      transactionId: result.transactionId,
      amount: Number(result.amount),
      currency: 'IRR',
      state: result.state,
      redirectUrl: result.redirectUrl,
    };
  }

  /**
   * POST /api/wallet/:profileId/bank-receipt-top-ups
   *
   * Bank-receipt top-up (T-04.2.02.03): customer submits amount, date,
   * payer reference, attachment, and optional note. Creates a Pending
   * ledger row. The wallet is not credited until staff confirmation.
   */
  @Post(':profileId/bank-receipt-top-ups')
  @RequiresCapability('wallet_topup')
  @HttpCode(201)
  @RateLimit({ namespace: 'wallet:bank-receipt-top-up:user', limit: 10, windowMs: 60_000 })
  @ApiOperation({ summary: 'Submit a bank-receipt wallet top-up (Pending until staff confirm)' })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiResponse({
    status: 201,
    description: 'Pending bank-receipt top-up created; balance unchanged.',
  })
  @ApiResponse({ status: 400, description: 'Invalid amount, date, payer reference, or attachment' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 404, description: 'Profile not found or not accessible' })
  @ApiResponse({
    status: 409,
    description: 'Idempotency key already used for a different operation',
  })
  async submitBankReceiptTopUp(
    @Param('profileId') profileId: string,
    @Body() rawBody: unknown,
    @Headers('idempotency-key') idempotencyHeader: string | undefined,
    @Req() req: AuthenticatedRequest
  ) {
    assertUuid(profileId, 'profileId');
    await this.assertProfileAccess(req, profileId, 'bank-receipts:submit');

    const parsed = BankReceiptBodySchema.safeParse(rawBody ?? {});
    if (!parsed.success) {
      httpError(
        ErrorCodes.VALIDATION_PARSE_ZOD,
        'Bank receipt top-up body must include amount, paymentDate, payerReference, and attachmentKey'
      );
    }

    const idempotencyKey = (idempotencyHeader ?? parsed.data.idempotencyKey ?? '').trim();
    if (!idempotencyKey) {
      httpError(
        ErrorCodes.VALIDATION_INPUT_MISSING,
        'Idempotency-Key header (or idempotencyKey in the body) is required'
      );
    }

    const result = await this.bankReceiptTopUpService.submit({
      profileId,
      amount: parsed.data.amount,
      paymentDate: parsed.data.paymentDate,
      payerReference: parsed.data.payerReference,
      attachmentKey: parsed.data.attachmentKey,
      customerNote: parsed.data.customerNote,
      idempotencyKey,
      actorId: req.session.userId,
      sessionId: req.session.sessionId,
      csrfToken: req.session.csrfToken,
    });

    this.logger.log(
      `Bank receipt top-up ${result.transactionId} submitted for profile ${profileId} by user ${req.session.userId}`
    );

    const response: BankReceiptTopUpResponse = {
      ok: true,
      transactionId: result.transactionId,
      amount: result.amount.toString(),
      currency: 'IRR',
      state: result.state,
      paymentDate: result.paymentDate,
      payerReference: result.payerReference,
      attachmentKey: result.attachmentKey,
    };
    return response;
  }

  @Get(':profileId/transactions')
  @ApiOperation({ summary: 'Get filtered, cursor-paginated history for the active profile' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: '1–100, default 50' })
  @ApiQuery({
    name: 'type',
    required: false,
    enum: ['topup', 'payment', 'refund', 'reservation', 'release', 'reversal', 'compensating'],
  })
  @ApiQuery({
    name: 'state',
    required: false,
    enum: ['Pending', 'Reserved', 'Completed', 'Failed', 'Rejected', 'Released', 'Reversed'],
  })
  @ApiQuery({ name: 'from', required: false, type: String, description: 'Inclusive ISO timestamp' })
  @ApiQuery({ name: 'to', required: false, type: String, description: 'Inclusive ISO timestamp' })
  @ApiQuery({ name: 'sort', required: false, enum: ['asc', 'desc'] })
  @ApiQuery({ name: 'cursor', required: false, type: String })
  @ApiResponse({
    status: 200,
    description: 'Wallet history; signed IRR amounts are exact decimal strings.',
    schema: {
      type: 'object',
      required: ['transactions', 'nextCursor'],
      properties: {
        nextCursor: { type: 'string', nullable: true },
        transactions: {
          type: 'array',
          items: {
            type: 'object',
            required: ['id', 'type', 'amount', 'state', 'refId', 'description', 'createdAt'],
            properties: {
              id: { type: 'string', format: 'uuid' },
              type: { type: 'string' },
              amount: { type: 'string', pattern: '^-?[0-9]+$', example: '9007199254740993' },
              state: { type: 'string' },
              refId: { type: 'string', nullable: true },
              description: { type: 'string', nullable: true },
              createdAt: { type: 'string', format: 'date-time' },
            },
          },
        },
      },
    },
  })
  async getTransactions(
    @Param('profileId') profileId: string,
    @Req() req: AuthenticatedRequest,
    @Query() rawQuery: unknown = {}
  ) {
    assertUuid(profileId, 'profileId');
    profileId = profileId.toLowerCase();
    const query = parseWalletHistoryQuery(rawQuery);
    return withCustomerWalletAccess(req.session, profileId, 'wallet:view', async (client) => {
      const active = await client.query(activeProfileSql('wallet:view'), [req.session.userId]);
      if (active.rows[0]?.id !== profileId) throw new NotFoundException('No active profile');
      return readWalletHistory(client, profileId, query);
    });
  }
}

/** Bank-receipt top-up JSON: int8 amounts are decimal strings, never JS numbers. */
export interface BankReceiptTopUpResponse {
  ok: true;
  transactionId: string;
  amount: string;
  currency: 'IRR';
  state: 'Pending';
  paymentDate: string;
  payerReference: string;
  attachmentKey: string;
}

function httpError(
  def: { code: string; httpStatus: number },
  message: string,
  statusCode = def.httpStatus
): never {
  throw new HttpException({ statusCode, error: def.code, message }, statusCode);
}

function assertUuid(id: string, label: string): void {
  const parsed = z.string().uuid('Expected a UUID').safeParse(id);
  if (!parsed.success) {
    httpError(ErrorCodes.VALIDATION_PARSE_ZOD, `Invalid ${label}: expected a UUID`);
  }
}
