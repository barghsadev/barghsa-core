import { createHash } from 'node:crypto'
import {
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import { getDbPool } from '@barghsa/db'
import { ErrorCodes } from '@barghsa/shared/errors'
import {
  BANK_RECEIPT_TOPUP_DESCRIPTION,
  bankReceiptTopUpMetadata,
  parseBankReceiptTopUpSubmission,
  receiptDetailsMatch,
  type BankReceiptTopUpDetails,
} from '@barghsa/shared/finance'
import { WalletService, type TransactionRow } from './wallet.service.js'

const PG_UNIQUE_VIOLATION = '23505'
const WALLET_TX_IDEMPOTENCY_CONSTRAINT = 'idx_wallet_tx_idempotency'

export interface SubmitBankReceiptTopUpInput {
  profileId: string
  amount: unknown
  paymentDate: unknown
  payerReference: unknown
  attachmentKey: unknown
  customerNote?: unknown
  idempotencyKey: string
}

export interface SubmitBankReceiptTopUpResult {
  transactionId: string
  amount: bigint
  state: 'Pending'
  paymentDate: string
  payerReference: string
  attachmentKey: string
}

interface QueryClient {
  query: (
    text: string,
    params?: unknown[],
  ) => Promise<{ rows: unknown[]; rowCount?: number | null }>
}

/**
 * Bank-receipt wallet top-up submission (T-04.2.02.03 / S-04.2.02).
 *
 * Order of operations:
 *   1. Validate amount, payment date, payer reference, attachment key,
 *      and optional note. Amount has **no configured maximum**.
 *   2. Ensure the profile wallet exists.
 *   3. Confirm the attachment is a live `storage_records` object
 *      (`active` or `immutable`) so a fabricated key cannot enter the
 *      ledger.
 *   4. Insert a Pending `topup` ledger row (does not change balances).
 *
 * Wallet credit is deferred to staff confirmation (T-04.2.02.04).
 * Rejected submissions never increase posted or reserved balance.
 */
@Injectable()
export class BankReceiptTopUpService {
  private readonly logger = new Logger(BankReceiptTopUpService.name)

  constructor(private readonly walletService: WalletService) {}

  async submit(input: SubmitBankReceiptTopUpInput): Promise<SubmitBankReceiptTopUpResult> {
    const idempotencyKey = input.idempotencyKey.trim()
    if (!idempotencyKey) {
      throw httpError(ErrorCodes.VALIDATION_INPUT_MISSING, 'Idempotency key is required')
    }

    const parsed = parseBankReceiptTopUpSubmission({
      amount: input.amount,
      paymentDate: input.paymentDate,
      payerReference: input.payerReference,
      attachmentKey: input.attachmentKey,
      customerNote: input.customerNote,
    })
    if (!parsed.ok) {
      throw httpError(ErrorCodes.VALIDATION_INPUT_INVALID, parsed.message)
    }

    await this.walletService.createWallet(input.profileId)

    const pool = getDbPool()
    const client = await pool.connect()
    const lockKeys = bankReceiptTopUpAdvisoryLockKeys(idempotencyKey)
    try {
      await client.query('SELECT pg_advisory_lock($1, $2)', lockKeys)
      try {
        await this.assertAttachmentRecord(client, parsed.receipt.attachmentKey)
        const pending = await this.insertOrReusePending(
          client,
          input.profileId,
          parsed.amountIrR,
          idempotencyKey,
          parsed.receipt,
        )
        this.logger.log(
          `Bank receipt top-up ${pending.id} pending for wallet ${pending.walletId}`,
        )
        return {
          transactionId: pending.id,
          amount: pending.amount,
          state: 'Pending',
          paymentDate: parsed.receipt.paymentDate,
          payerReference: parsed.receipt.payerReference,
          attachmentKey: parsed.receipt.attachmentKey,
        }
      } finally {
        await client.query('SELECT pg_advisory_unlock($1, $2)', lockKeys)
      }
    } finally {
      client.release()
    }
  }

  /**
   * The attachment must already exist in `storage_records` as a live
   * object. Upload type/size is enforced at presign/verify; this check
   * stops a client from pointing the Pending row at a key that was
   * never recorded.
   */
  private async assertAttachmentRecord(client: QueryClient, attachmentKey: string): Promise<void> {
    const result = await client.query(
      `SELECT status FROM storage_records WHERE storage_key = $1`,
      [attachmentKey],
    )
    if (result.rows.length === 0) {
      throw httpError(
        ErrorCodes.VALIDATION_INPUT_INVALID,
        'Bank receipt attachment has not been uploaded and recorded',
      )
    }
    const status = (result.rows[0] as { status: string }).status
    if (status === 'removed') {
      throw httpError(
        ErrorCodes.VALIDATION_INPUT_INVALID,
        'Bank receipt attachment is no longer available',
      )
    }
  }

  private async insertOrReusePending(
    client: QueryClient,
    profileId: string,
    amountIrR: bigint,
    idempotencyKey: string,
    receipt: BankReceiptTopUpDetails,
  ): Promise<TransactionRow> {
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
        `SELECT * FROM wallet_transactions WHERE idempotency_key = $1 FOR UPDATE`,
        [idempotencyKey],
      )
      if (idemResult.rows.length > 0) {
        const existing = idemResult.rows[0]!
        assertMatchingPendingBankReceipt(
          existing as Parameters<typeof assertMatchingPendingBankReceipt>[0],
          canonicalWalletId,
          amountIrR,
          receipt,
        )
        await client.query('COMMIT')
        return mapTransaction(existing as Parameters<typeof mapTransaction>[0])
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
          BANK_RECEIPT_TOPUP_DESCRIPTION,
          JSON.stringify(bankReceiptTopUpMetadata(receipt)),
        ],
      )

      await client.query('COMMIT')
      return mapTransaction(txResult.rows[0] as Parameters<typeof mapTransaction>[0])
    } catch (error) {
      await client.query('ROLLBACK')
      if (isPgUniqueViolation(error, WALLET_TX_IDEMPOTENCY_CONSTRAINT)) {
        const existing = await client.query(
          `SELECT * FROM wallet_transactions WHERE idempotency_key = $1`,
          [idempotencyKey],
        )
        if (existing.rows.length === 0 || canonicalWalletId === undefined) {
          throw new ConflictException('Idempotency key already used')
        }
        const committed = existing.rows[0]!
        assertMatchingPendingBankReceipt(
          committed as Parameters<typeof assertMatchingPendingBankReceipt>[0],
          canonicalWalletId,
          amountIrR,
          receipt,
        )
        return mapTransaction(committed as Parameters<typeof mapTransaction>[0])
      }
      throw error
    }
  }
}

export function bankReceiptTopUpAdvisoryLockKeys(idempotencyKey: string): [number, number] {
  const digest = createHash('sha256')
    .update(`wallet-bank-receipt-topup:${idempotencyKey}`)
    .digest()
  return [digest.readInt32BE(0), digest.readInt32BE(4)]
}

function assertMatchingPendingBankReceipt(
  existing: {
    wallet_id: string
    type: string
    amount: string | number | bigint
    state: string
    metadata?: unknown
  },
  canonicalWalletId: string,
  amountIrR: bigint,
  receipt: BankReceiptTopUpDetails,
): void {
  if (existing.wallet_id !== canonicalWalletId) {
    throw new ConflictException('Idempotency key already used for a different wallet')
  }
  const isSamePending =
    existing.state === 'Pending' &&
    existing.type === 'topup' &&
    BigInt(existing.amount) === amountIrR &&
    receiptDetailsMatch(existing.metadata, receipt)
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
