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
  UseGuards,
} from '@nestjs/common'
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { z } from 'zod'
import { ErrorCodes } from '@barghsa/shared/errors'
import { parseOnlineTopUpAmountIrR } from '@barghsa/shared/finance'
import { SessionAuthGuard } from '../session/session.guard.js'
import type { AuthenticatedRequest } from '../session/session.guard.js'
import { RateLimit } from '../rate-limit/rate-limit.decorator.js'
import { WalletService } from './wallet.service.js'
import { ProfilesService } from '../profiles/profiles.service.js'
import { OnlineTopUpService } from './online-topup.service.js'
import { BankReceiptTopUpService } from './bank-receipt-topup.service.js'

const InitiateBodySchema = z
  .object({
    amount: z.union([z.number(), z.string()]),
    idempotencyKey: z.string().min(1).optional(),
  })
  .strict()

const BankReceiptBodySchema = z
  .object({
    amount: z.union([z.number(), z.string()]),
    paymentDate: z.string().min(1),
    payerReference: z.string().min(1),
    attachmentKey: z.string().min(1),
    customerNote: z.string().optional(),
    idempotencyKey: z.string().min(1).optional(),
  })
  .strict()

@ApiTags('Wallet')
@ApiBearerAuth()
@UseGuards(SessionAuthGuard)
@Controller('api/wallet')
export class WalletController {
  private readonly logger = new Logger(WalletController.name)

  constructor(
    private readonly walletService: WalletService,
    private readonly profilesService: ProfilesService,
    private readonly onlineTopUpService: OnlineTopUpService,
    private readonly bankReceiptTopUpService: BankReceiptTopUpService,
  ) {}

  /**
   * Verify that the authenticated user has access to the given profile.
   * Throws NotFoundException if the profile doesn't belong to the user.
   */
  private async assertProfileAccess(req: AuthenticatedRequest, profileId: string): Promise<void> {
    const profile = await this.profilesService.getAccessibleProfile(req.session.userId, profileId)
    if (!profile) {
      throw new NotFoundException(`Profile ${profileId} not found or not accessible`)
    }
  }

  @Get(':profileId')
  @ApiOperation({ summary: 'Get wallet balance for a profile' })
  async getWallet(
    @Param('profileId') profileId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    await this.assertProfileAccess(req, profileId)
    this.logger.debug(`Wallet inquiry: user=${req.session.userId} profile=${profileId}`)
    const wallet = await this.walletService.getWallet(profileId)
    if (!wallet) return { balance: 0, currency: 'IRR' }
    return {
      balance: Number(wallet.availableBalance),
      postedBalance: Number(wallet.postedBalance),
      reservedBalance: Number(wallet.reservedBalance),
      currency: 'IRR',
    }
  }

  @Post(':profileId/create')
  @ApiOperation({ summary: 'Create wallet for a profile' })
  async createWallet(
    @Param('profileId') profileId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    await this.assertProfileAccess(req, profileId)
    this.logger.debug(`Wallet creation: user=${req.session.userId} profile=${profileId}`)
    const wallet = await this.walletService.createWallet(profileId)
    return {
      ok: true,
      balance: Number(wallet.availableBalance),
      currency: 'IRR',
    }
  }

  /**
   * POST /api/wallet/:profileId/top-ups
   *
   * Online top-up initiation (T-04.2.02.01): validate the per-transaction
   * limit, insert a Pending ledger row, and return the payment-gateway
   * redirect URL. The wallet is not credited here.
   */
  @Post(':profileId/top-ups')
  @HttpCode(201)
  @RateLimit({ namespace: 'wallet:top-up:user', limit: 10, windowMs: 60_000 })
  @ApiOperation({ summary: 'Start an online wallet top-up and redirect to the payment gateway' })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiResponse({ status: 201, description: 'Pending top-up created; client must redirect to redirectUrl.' })
  @ApiResponse({ status: 400, description: 'Invalid amount or over the configured limit' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 404, description: 'Profile not found or not accessible' })
  @ApiResponse({ status: 409, description: 'Idempotency key already used for a different operation' })
  async initiateOnlineTopUp(
    @Param('profileId') profileId: string,
    @Body() rawBody: unknown,
    @Headers('idempotency-key') idempotencyHeader: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    assertUuid(profileId, 'profileId')
    await this.assertProfileAccess(req, profileId)

    const parsed = InitiateBodySchema.safeParse(rawBody ?? {})
    if (!parsed.success) {
      httpError(
        ErrorCodes.VALIDATION_PARSE_ZOD,
        'Online top-up body must include a numeric amount',
      )
    }

    const amountIrR = parseOnlineTopUpAmountIrR(parsed.data.amount)
    if (amountIrR === null) {
      httpError(
        ErrorCodes.VALIDATION_INPUT_INVALID,
        'Online top-up amount must be a positive integer IRR value',
      )
    }

    const idempotencyKey = (idempotencyHeader ?? parsed.data.idempotencyKey ?? '').trim()
    if (!idempotencyKey) {
      httpError(
        ErrorCodes.VALIDATION_INPUT_MISSING,
        'Idempotency-Key header (or idempotencyKey in the body) is required',
      )
    }

    const result = await this.onlineTopUpService.initiate({
      profileId,
      amountIrR,
      idempotencyKey,
    })

    this.logger.log(
      `Online top-up ${result.transactionId} initiated for profile ${profileId} by user ${req.session.userId}`,
    )

    return {
      ok: true,
      transactionId: result.transactionId,
      amount: Number(result.amount),
      currency: 'IRR',
      state: result.state,
      redirectUrl: result.redirectUrl,
    }
  }

  /**
   * POST /api/wallet/:profileId/bank-receipt-top-ups
   *
   * Bank-receipt top-up (T-04.2.02.03): customer submits amount, date,
   * payer reference, attachment, and optional note. Creates a Pending
   * ledger row. The wallet is not credited until staff confirmation.
   */
  @Post(':profileId/bank-receipt-top-ups')
  @HttpCode(201)
  @RateLimit({ namespace: 'wallet:bank-receipt-top-up:user', limit: 10, windowMs: 60_000 })
  @ApiOperation({ summary: 'Submit a bank-receipt wallet top-up (Pending until staff confirm)' })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiResponse({ status: 201, description: 'Pending bank-receipt top-up created; balance unchanged.' })
  @ApiResponse({ status: 400, description: 'Invalid amount, date, payer reference, or attachment' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 404, description: 'Profile not found or not accessible' })
  @ApiResponse({ status: 409, description: 'Idempotency key already used for a different operation' })
  async submitBankReceiptTopUp(
    @Param('profileId') profileId: string,
    @Body() rawBody: unknown,
    @Headers('idempotency-key') idempotencyHeader: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    assertUuid(profileId, 'profileId')
    await this.assertProfileAccess(req, profileId)

    const parsed = BankReceiptBodySchema.safeParse(rawBody ?? {})
    if (!parsed.success) {
      httpError(
        ErrorCodes.VALIDATION_PARSE_ZOD,
        'Bank receipt top-up body must include amount, paymentDate, payerReference, and attachmentKey',
      )
    }

    const idempotencyKey = (idempotencyHeader ?? parsed.data.idempotencyKey ?? '').trim()
    if (!idempotencyKey) {
      httpError(
        ErrorCodes.VALIDATION_INPUT_MISSING,
        'Idempotency-Key header (or idempotencyKey in the body) is required',
      )
    }

    const result = await this.bankReceiptTopUpService.submit({
      profileId,
      amount: parsed.data.amount,
      paymentDate: parsed.data.paymentDate,
      payerReference: parsed.data.payerReference,
      attachmentKey: parsed.data.attachmentKey,
      customerNote: parsed.data.customerNote,
      idempotencyKey,
    })

    this.logger.log(
      `Bank receipt top-up ${result.transactionId} submitted for profile ${profileId} by user ${req.session.userId}`,
    )

    return {
      ok: true,
      transactionId: result.transactionId,
      amount: Number(result.amount),
      currency: 'IRR',
      state: result.state,
      paymentDate: result.paymentDate,
      payerReference: result.payerReference,
      attachmentKey: result.attachmentKey,
    }
  }

  @Get(':profileId/transactions')
  @ApiOperation({ summary: 'Get wallet transaction history' })
  async getTransactions(
    @Param('profileId') profileId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    await this.assertProfileAccess(req, profileId)
    this.logger.debug(`Wallet transactions: user=${req.session.userId} profile=${profileId}`)
    const transactions = await this.walletService.getTransactions(profileId)
    return {
      transactions: transactions.map((tx) => ({
        id: tx.id,
        type: tx.type,
        amount: Number(tx.amount),
        state: tx.state,
        refId: tx.refId,
        description: tx.description,
        createdAt: tx.createdAt,
      })),
    }
  }
}

function httpError(
  def: { code: string; httpStatus: number },
  message: string,
  statusCode = def.httpStatus,
): never {
  throw new HttpException({ statusCode, error: def.code, message }, statusCode)
}

function assertUuid(id: string, label: string): void {
  const parsed = z.string().uuid('Expected a UUID').safeParse(id)
  if (!parsed.success) {
    httpError(ErrorCodes.VALIDATION_PARSE_ZOD, `Invalid ${label}: expected a UUID`)
  }
}
