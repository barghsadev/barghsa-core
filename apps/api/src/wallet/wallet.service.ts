import { Injectable, Logger, BadRequestException, ConflictException, NotFoundException } from '@nestjs/common'
import { getDbPool } from '@barghsa/db'
import {
  WALLET_TOP_UP_LIMIT_CONFIG_KEY,
  DEFAULT_WALLET_TOP_UP_LIMIT_CONFIG,
  toWalletTopUpLimitConfig,
  isOnlineWalletTopUpAllowed,
  type WalletTopUpLimitConfig,
} from '@barghsa/shared/finance'

const PG_UNIQUE_VIOLATION = '23505'
const WALLET_TX_IDEMPOTENCY_CONSTRAINT = 'idx_wallet_tx_idempotency'

/** Ledger types that post as a credit (positive amount, money in). */
const WALLET_CREDIT_TYPES = ['topup', 'refund', 'compensating', 'reversal'] as const
type WalletCreditType = (typeof WALLET_CREDIT_TYPES)[number]

export interface WalletRow {
  profileId: string
  postedBalance: bigint
  reservedBalance: bigint
  version: number
  updatedAt: Date
  availableBalance: bigint
}

export interface TransactionRow {
  id: string
  walletId: string
  type: string
  amount: bigint
  state: string
  idempotencyKey: string
  refId: string | null
  description: string | null
  metadata: unknown | null
  createdAt: Date
  updatedAt: Date
}

/**
 * Credit reference payload (T-04.2.01.03).
 *
 * `type` is the ledger discriminator; `refId` optionally points at the
 * originating domain entity (invoice, refund, provider event, …).
 */
export interface WalletCreditRef {
  type: WalletCreditType
  refId?: string | null
  description?: string | null
  metadata?: unknown
}

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name)

  /**
   * Get a wallet by profile ID. Returns null if no wallet exists yet.
   */
  async getWallet(profileId: string): Promise<WalletRow | null> {
    const pool = getDbPool()
    const result = await pool.query(
      `SELECT *, (posted_balance - reserved_balance) AS available_balance
       FROM wallets WHERE profile_id = $1`,
      [profileId],
    )

    if (result.rows.length === 0) return null
    return mapWallet(result.rows[0])
  }

  /**
   * Create a wallet for a profile. Idempotent — returns existing if present.
   */
  async createWallet(profileId: string): Promise<WalletRow> {
    const pool = getDbPool()

    // Try INSERT; if concurrent insert won the race, fall back to SELECT
    const result = await pool.query(
      `INSERT INTO wallets (profile_id) VALUES ($1)
       ON CONFLICT (profile_id) DO NOTHING
       RETURNING *, (posted_balance - reserved_balance) AS available_balance`,
      [profileId],
    )

    if (result.rows.length === 0) {
      // Another request created the wallet first — return that one
      const existing = await this.getWallet(profileId)
      if (!existing) throw new NotFoundException('Wallet creation failed despite insert attempt')
      return existing
    }

    return mapWallet(result.rows[0])
  }

  /**
   * Execute a money-mutating operation inside an atomic transaction.
   * Handles idempotency, optimistic locking, and error recovery.
   */
  private async executeWalletTx<T>(
    walletId: string,
    idempotencyKey: string,
    fn: (client: any, wallet: any) => Promise<T>,
  ): Promise<T> {
    const pool = getDbPool()
    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      // Lock the wallet row
      const walletResult = await client.query(
        `SELECT * FROM wallets WHERE profile_id = $1 FOR UPDATE`,
        [walletId],
      )
      if (walletResult.rows.length === 0) {
        throw new NotFoundException(`Wallet not found: ${walletId}`)
      }

      // Check idempotency INSIDE the transaction (after FOR UPDATE lock)
      const idemResult = await client.query(
        `SELECT * FROM wallet_transactions WHERE idempotency_key = $1`,
        [idempotencyKey],
      )
      if (idemResult.rows.length > 0) {
        await client.query('COMMIT')
        return mapTransaction(idemResult.rows[0]) as unknown as T
      }

      const result = await fn(client, walletResult.rows[0])

      await client.query('COMMIT')
      return result
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  /**
   * Credit a wallet (T-04.2.01.03).
   *
   * In one DB transaction:
   *   1. `SELECT … FOR UPDATE` the wallet row.
   *   2. Return the existing ledger row when `idempotencyKey` already posted.
   *   3. INSERT a Completed ledger row (positive amount).
   *   4. UPDATE `posted_balance` with
   *      `WHERE version = X AND posted_balance >= 0`.
   *
   * The version predicate is optimistic locking; the non-negative
   * `posted_balance` predicate refuses to post onto a corrupt wallet.
   * Unique `idempotency_key` is the last-line duplicate guard.
   */
  async credit(
    walletId: string,
    amount: bigint,
    ref: WalletCreditRef,
    idempotencyKey: string,
  ): Promise<TransactionRow> {
    if (amount <= 0n) throw new BadRequestException('Credit amount must be positive')
    if (!idempotencyKey.trim()) {
      throw new BadRequestException('Idempotency key is required')
    }
    if (!isWalletCreditType(ref.type)) {
      throw new BadRequestException(`Credit type must be one of: ${WALLET_CREDIT_TYPES.join(', ')}`)
    }

    const pool = getDbPool()
    const client = await pool.connect()
    // PostgreSQL UUID columns return canonical lowercase; callers may pass
    // any valid spelling. Ownership checks must use the row's profile_id.
    let canonicalWalletId: string | undefined
    try {
      await client.query('BEGIN')

      const walletResult = await client.query(
        `SELECT * FROM wallets WHERE profile_id = $1 FOR UPDATE`,
        [walletId],
      )
      if (walletResult.rows.length === 0) {
        throw new NotFoundException(`Wallet not found: ${walletId}`)
      }
      const wallet = walletResult.rows[0] as { version: number; profile_id: string }
      canonicalWalletId = wallet.profile_id

      const idemResult = await client.query(
        `SELECT * FROM wallet_transactions WHERE idempotency_key = $1`,
        [idempotencyKey],
      )
      if (idemResult.rows.length > 0) {
        const existing = idemResult.rows[0] as { wallet_id: string }
        if (existing.wallet_id !== canonicalWalletId) {
          throw new ConflictException('Idempotency key already used for a different wallet')
        }
        await client.query('COMMIT')
        return mapTransaction(idemResult.rows[0])
      }

      const txResult = await client.query(
        `INSERT INTO wallet_transactions
           (wallet_id, type, amount, state, idempotency_key, ref_id, description, metadata)
         VALUES ($1, $2, $3::bigint, 'Completed', $4, $5, $6, COALESCE($7::jsonb, '{}'::jsonb))
         RETURNING *`,
        [
          walletId,
          ref.type,
          amount,
          idempotencyKey,
          ref.refId ?? null,
          ref.description ?? null,
          ref.metadata === undefined ? null : JSON.stringify(ref.metadata),
        ],
      )

      const updateResult = await client.query(
        `UPDATE wallets
         SET posted_balance = posted_balance + $1,
             version = version + 1,
             updated_at = NOW()
         WHERE profile_id = $2
           AND version = $3
           AND posted_balance >= 0
         RETURNING *`,
        [amount, walletId, wallet.version],
      )
      if (updateResult.rows.length === 0) {
        throw new ConflictException(
          'Wallet credit rejected: version mismatch or postedBalance < 0',
        )
      }

      await client.query('COMMIT')
      return mapTransaction(txResult.rows[0])
    } catch (error) {
      await client.query('ROLLBACK')
      if (isPgUniqueViolation(error, WALLET_TX_IDEMPOTENCY_CONSTRAINT)) {
        const existing = await pool.query(
          `SELECT * FROM wallet_transactions WHERE idempotency_key = $1`,
          [idempotencyKey],
        )
        if (
          existing.rows.length > 0 &&
          canonicalWalletId !== undefined &&
          existing.rows[0]!.wallet_id === canonicalWalletId
        ) {
          return mapTransaction(existing.rows[0])
        }
        throw new ConflictException('Idempotency key already used')
      }
      throw error
    } finally {
      client.release()
    }
  }

  /**
   * Debit a wallet (money out). Checks available balance >= amount before proceeding.
   */
  async debit(
    walletId: string,
    amount: bigint,
    ref: { idempotencyKey: string; type: string; refId?: string; description?: string },
  ): Promise<TransactionRow> {
    if (amount <= 0n) throw new BadRequestException('Debit amount must be positive')

    return this.executeWalletTx(walletId, ref.idempotencyKey, async (client, wallet) => {
      const available = wallet.posted_balance - wallet.reserved_balance
      if (available < amount) {
        throw new BadRequestException(
          `Insufficient balance: available=${available.toString()}, required=${amount.toString()}`,
        )
      }

      const updateResult = await client.query(
        `UPDATE wallets
         SET posted_balance = posted_balance - $1,
             version = version + 1,
             updated_at = NOW()
         WHERE profile_id = $2 AND version = $3
         RETURNING *`,
        [amount, walletId, wallet.version],
      )
      if (updateResult.rows.length === 0) {
        throw new ConflictException('Concurrent wallet modification detected')
      }

      const txResult = await client.query(
        `INSERT INTO wallet_transactions (wallet_id, type, amount, state, idempotency_key, ref_id, description)
         VALUES ($1, $2, $3::bigint, 'Completed', $4, $5, $6)
         RETURNING *`,
        [walletId, ref.type, -amount, ref.idempotencyKey, ref.refId ?? null, ref.description ?? null],
      )

      return mapTransaction(txResult.rows[0])
    })
  }

  /**
   * Reserve amount in wallet for pending payment. Reduces available balance.
   */
  async reserve(
    walletId: string,
    amount: bigint,
    idempotencyKey: string,
    ref?: { refId?: string; description?: string },
  ): Promise<TransactionRow> {
    if (amount <= 0n) throw new BadRequestException('Reserve amount must be positive')

    return this.executeWalletTx(walletId, idempotencyKey, async (client, wallet) => {
      const available = wallet.posted_balance - wallet.reserved_balance
      if (available < amount) {
        throw new BadRequestException(
          `Insufficient balance for reservation: available=${available.toString()}, required=${amount.toString()}`,
        )
      }

      const updateResult = await client.query(
        `UPDATE wallets
         SET reserved_balance = reserved_balance + $1,
             version = version + 1,
             updated_at = NOW()
         WHERE profile_id = $2 AND version = $3
         RETURNING *`,
        [amount, walletId, wallet.version],
      )
      if (updateResult.rows.length === 0) {
        throw new ConflictException('Concurrent wallet modification detected during reserve')
      }

      const txResult = await client.query(
        `INSERT INTO wallet_transactions (wallet_id, type, amount, state, idempotency_key, ref_id, description)
         VALUES ($1, 'reservation', $2::bigint, 'Reserved', $3, $4, $5)
         RETURNING *`,
        [walletId, amount, idempotencyKey, ref?.refId ?? null, ref?.description ?? null],
      )

      return mapTransaction(txResult.rows[0])
    })
  }

  /**
   * Release a previous reservation. Reduces reserved balance without affecting posted balance.
   */
  async release(reservationId: string): Promise<{ released: boolean; walletId: string; amount: bigint }> {
    const pool = getDbPool()

    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      // Lock and re-check the reservation inside the transaction
      const reservationResult = await client.query(
        `SELECT * FROM wallet_transactions WHERE id = $1 FOR UPDATE`,
        [reservationId],
      )
      if (reservationResult.rows.length === 0) {
        await client.query('COMMIT')
        throw new NotFoundException(`Reservation not found: ${reservationId}`)
      }
      const reservation = reservationResult.rows[0]!
      if (reservation.state !== 'Reserved') {
        await client.query('COMMIT')
        // Already released — return idempotent success
        return { released: false, walletId: reservation.wallet_id, amount: BigInt(reservation.amount) }
      }

      const walletResult = await client.query(
        `SELECT * FROM wallets WHERE profile_id = $1 FOR UPDATE`,
        [reservation.wallet_id],
      )
      const wallet = walletResult.rows[0]

      const updateResult = await client.query(
        `UPDATE wallets
         SET reserved_balance = reserved_balance - $1,
             version = version + 1,
             updated_at = NOW()
         WHERE profile_id = $2 AND version = $3
         RETURNING *`,
        [reservation.amount, reservation.wallet_id, wallet.version],
      )
      if (updateResult.rows.length === 0) {
        throw new ConflictException('Concurrent wallet modification detected during release')
      }

      await client.query(
        `UPDATE wallet_transactions SET state = 'Released' WHERE id = $1`,
        [reservationId],
      )

      await client.query('COMMIT')
      return { released: true, walletId: reservation.wallet_id, amount: BigInt(reservation.amount) }
    } catch (error) {
      await client.query('ROLLBACK')
      this.logger.error(`Release failed: ${error}`)
      throw error
    } finally {
      client.release()
    }
  }

  /**
   * Get transaction history for a wallet.
   */
  async getTransactions(
    walletId: string,
    limit = 50,
    offset = 0,
  ): Promise<TransactionRow[]> {
    const pool = getDbPool()
    const result = await pool.query(
      `SELECT * FROM wallet_transactions
       WHERE wallet_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [walletId, limit, offset],
    )
    return result.rows.map(mapTransaction)
  }

  /**
   * Enforce the admin-configured per-transaction online wallet top-up limit
   * (T-09.10.01).
   *
   * The online top-up initiation flow (S-04.2.02, T-04.2.02.01) must call
   * this **before** creating a Pending top-up transaction, so no single
   * online top-up can exceed the admin-configured ceiling. Reads the
   * `finance.wallet_top_up_limit` value from `app_config`, falling back to
   * the 2,000,000,000 IRR default when nothing is persisted, and rejects
   * amounts over it with a 400.
   *
   * @throws BadRequestException when the amount is non-positive or exceeds
   *   the configured limit.
   */
  async validateOnlineTopUpAmount(amountIrR: bigint): Promise<void> {
    if (amountIrR <= 0n) {
      throw new BadRequestException('Online top-up amount must be positive')
    }
    const limit = await this.getOnlineTopUpLimitConfig()
    if (!isOnlineWalletTopUpAllowed(limit, amountIrR)) {
      throw new BadRequestException(
        `Online top-up amount ${amountIrR.toString()} IRR exceeds the configured per-transaction limit of ${limit.limitIrR} IRR`,
      )
    }
  }

  /** Read the current online top-up limit config (default 2e9 IRR when unset). */
  private async getOnlineTopUpLimitConfig(): Promise<WalletTopUpLimitConfig> {
    const pool = getDbPool()
    const result = await pool.query(
      `SELECT value FROM app_config WHERE key = $1`,
      [WALLET_TOP_UP_LIMIT_CONFIG_KEY],
    )
    if (result.rows.length === 0) return { ...DEFAULT_WALLET_TOP_UP_LIMIT_CONFIG }
    return toWalletTopUpLimitConfig(result.rows[0]!.value)
  }
}

function mapWallet(row: any): WalletRow {
  return {
    profileId: row.profile_id,
    postedBalance: BigInt(row.posted_balance),
    reservedBalance: BigInt(row.reserved_balance),
    version: row.version,
    updatedAt: row.updated_at,
    availableBalance: BigInt(row.available_balance ?? (row.posted_balance - row.reserved_balance)),
  }
}

function mapTransaction(row: any): TransactionRow {
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

function isWalletCreditType(type: string): type is WalletCreditType {
  return (WALLET_CREDIT_TYPES as readonly string[]).includes(type)
}

function isPgUniqueViolation(error: unknown, constraint?: string): boolean {
  if (!error || typeof error !== 'object') return false
  const pgError = error as { code?: string; constraint?: string }
  if (pgError.code !== PG_UNIQUE_VIOLATION) return false
  return constraint === undefined || pgError.constraint === constraint
}
