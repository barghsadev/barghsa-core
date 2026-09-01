import {
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import { getDbPool } from '@barghsa/db'
import { ErrorCodes } from '@barghsa/shared/errors'
import { WalletService, type TransactionRow } from './wallet.service.js'
import {
  PAYMENT_GATEWAY,
  resolvePaymentGatewayCallbackUrl,
  type PaymentGateway,
  type PaymentGatewayStartResult,
} from './payment-gateway.js'

const PG_UNIQUE_VIOLATION = '23505'
const WALLET_TX_IDEMPOTENCY_CONSTRAINT = 'idx_wallet_tx_idempotency'
const ONLINE_TOPUP_DESCRIPTION = 'Online wallet top-up'

export interface InitiateOnlineTopUpInput {
  profileId: string
  amountIrR: bigint
  idempotencyKey: string
}

export interface InitiateOnlineTopUpResult {
  transactionId: string
  amount: bigint
  state: 'Pending'
  redirectUrl: string
}

interface GatewaySessionMeta {
  authority: string
  redirectUrl: string
}

/**
 * Online wallet top-up initiation (T-04.2.02.01 / S-04.2.02).
 *
 * Order of operations:
 *   1. Enforce the admin-configured per-transaction limit.
 *   2. Ensure the profile wallet exists.
 *   3. Insert a Pending `topup` ledger row (does not change balances).
 *   4. Start a payment-gateway session and return the browser redirect URL.
 *
 * Wallet credit is intentionally deferred to the authenticated provider
 * callback (T-04.2.02.02). Browser redirect is not proof of payment.
 */
@Injectable()
export class OnlineTopUpService {
  private readonly logger = new Logger(OnlineTopUpService.name)

  constructor(
    private readonly walletService: WalletService,
    @Inject(PAYMENT_GATEWAY) private readonly paymentGateway: PaymentGateway,
  ) {}

  async initiate(input: InitiateOnlineTopUpInput): Promise<InitiateOnlineTopUpResult> {
    const idempotencyKey = input.idempotencyKey.trim()
    if (!idempotencyKey) {
      throw httpError(
        ErrorCodes.VALIDATION_INPUT_MISSING,
        'Idempotency key is required',
      )
    }

    await this.walletService.validateOnlineTopUpAmount(input.amountIrR)
    await this.walletService.createWallet(input.profileId)

    const pending = await this.insertOrReusePending(
      input.profileId,
      input.amountIrR,
      idempotencyKey,
    )

    const existing = readGatewaySession(pending.metadata)
    if (existing) {
      return toResult(pending, existing.redirectUrl)
    }

    let session: PaymentGatewayStartResult
    try {
      session = await this.paymentGateway.startPayment({
        amountIrR: input.amountIrR,
        merchantOrderId: pending.id,
        description: ONLINE_TOPUP_DESCRIPTION,
        callbackUrl: resolvePaymentGatewayCallbackUrl(),
      })
    } catch (error) {
      this.logger.error(
        `Payment gateway start failed for pending top-up ${pending.id}`,
        error instanceof Error ? error.stack : undefined,
      )
      throw httpError(
        ErrorCodes.PROVIDER_DOWNSTREAM,
        'Payment gateway is unavailable',
        502,
      )
    }

    await this.attachGatewaySession(pending.id, session)
    return toResult(pending, session.redirectUrl)
  }

  /**
   * Insert a Pending online top-up, or reuse a matching in-flight row
   * when the client retries with the same idempotency key.
   */
  private async insertOrReusePending(
    profileId: string,
    amountIrR: bigint,
    idempotencyKey: string,
  ): Promise<TransactionRow> {
    const pool = getDbPool()
    const client = await pool.connect()
    let canonicalWalletId: string | undefined
    try {
      await client.query('BEGIN')

      const walletResult = await client.query(
        `SELECT profile_id FROM wallets WHERE profile_id = $1 FOR UPDATE`,
        [profileId],
      )
      if (walletResult.rows.length === 0) {
        throw new NotFoundException(`Wallet not found: ${profileId}`)
      }
      canonicalWalletId = (walletResult.rows[0] as { profile_id: string }).profile_id

      const idemResult = await client.query(
        `SELECT * FROM wallet_transactions WHERE idempotency_key = $1`,
        [idempotencyKey],
      )
      if (idemResult.rows.length > 0) {
        const existing = idemResult.rows[0]!
        assertMatchingPendingTopUp(existing, canonicalWalletId, amountIrR)
        await client.query('COMMIT')
        return mapTransaction(existing)
      }

      const txResult = await client.query(
        `INSERT INTO wallet_transactions
           (wallet_id, type, amount, state, idempotency_key, description, metadata)
         VALUES ($1, 'topup', $2::bigint, 'Pending', $3, $4, $5::jsonb)
         RETURNING *`,
        [
          canonicalWalletId,
          amountIrR.toString(),
          idempotencyKey,
          ONLINE_TOPUP_DESCRIPTION,
          JSON.stringify({ channel: 'online' }),
        ],
      )

      await client.query('COMMIT')
      return mapTransaction(txResult.rows[0])
    } catch (error) {
      await client.query('ROLLBACK')
      if (isPgUniqueViolation(error, WALLET_TX_IDEMPOTENCY_CONSTRAINT)) {
        const existing = await pool.query(
          `SELECT * FROM wallet_transactions WHERE idempotency_key = $1`,
          [idempotencyKey],
        )
        if (existing.rows.length === 0 || canonicalWalletId === undefined) {
          throw new ConflictException('Idempotency key already used')
        }
        const committed = existing.rows[0]!
        assertMatchingPendingTopUp(committed, canonicalWalletId, amountIrR)
        return mapTransaction(committed)
      }
      throw error
    } finally {
      client.release()
    }
  }

  private async attachGatewaySession(
    transactionId: string,
    session: PaymentGatewayStartResult,
  ): Promise<void> {
    const pool = getDbPool()
    await pool.query(
      `UPDATE wallet_transactions
       SET metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb,
           ref_id = COALESCE(ref_id, $3)
       WHERE id = $1 AND state = 'Pending'`,
      [
        transactionId,
        JSON.stringify({
          gateway: {
            authority: session.authority,
            redirectUrl: session.redirectUrl,
          },
        }),
        session.authority,
      ],
    )
  }
}

function toResult(tx: TransactionRow, redirectUrl: string): InitiateOnlineTopUpResult {
  return {
    transactionId: tx.id,
    amount: tx.amount,
    state: 'Pending',
    redirectUrl,
  }
}

function readGatewaySession(metadata: unknown): GatewaySessionMeta | null {
  if (!metadata || typeof metadata !== 'object') return null
  const gateway = (metadata as { gateway?: unknown }).gateway
  if (!gateway || typeof gateway !== 'object') return null
  const record = gateway as { authority?: unknown; redirectUrl?: unknown }
  if (typeof record.authority !== 'string' || record.authority.length === 0) return null
  if (typeof record.redirectUrl !== 'string' || record.redirectUrl.length === 0) return null
  return { authority: record.authority, redirectUrl: record.redirectUrl }
}

function assertMatchingPendingTopUp(
  existing: {
    wallet_id: string
    type: string
    amount: string | number | bigint
    state: string
  },
  canonicalWalletId: string,
  amountIrR: bigint,
): void {
  if (existing.wallet_id !== canonicalWalletId) {
    throw new ConflictException('Idempotency key already used for a different wallet')
  }
  const isSamePending =
    existing.state === 'Pending' &&
    existing.type === 'topup' &&
    BigInt(existing.amount) === amountIrR
  if (!isSamePending) {
    throw new ConflictException('Idempotency key already used for a different wallet operation')
  }
}

function mapTransaction(row: {
  id: string
  wallet_id: string
  type: string
  amount: string | number | bigint
  state: string
  idempotency_key: string
  ref_id?: string | null
  description?: string | null
  metadata?: unknown
  created_at: Date
  updated_at: Date
}): TransactionRow {
  return {
    id: row.id,
    walletId: row.wallet_id,
    type: row.type,
    amount: BigInt(row.amount),
    state: row.state,
    idempotencyKey: row.idempotency_key,
    refId: row.ref_id ?? null,
    description: row.description ?? null,
    metadata: row.metadata ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function isPgUniqueViolation(error: unknown, constraint?: string): boolean {
  if (!error || typeof error !== 'object') return false
  const pgError = error as { code?: string; constraint?: string }
  if (pgError.code !== PG_UNIQUE_VIOLATION) return false
  return constraint === undefined || pgError.constraint === constraint
}

function httpError(
  def: { code: string; httpStatus: number },
  message: string,
  statusCode = def.httpStatus,
): never {
  throw new HttpException({ statusCode, error: def.code, message }, statusCode)
}
