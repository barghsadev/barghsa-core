import { Injectable, BadRequestException, ConflictException, NotFoundException } from '@nestjs/common'
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

/** Ledger types that post as a debit (negative amount, money out). */
const WALLET_DEBIT_TYPES = ['payment', 'compensating', 'reversal'] as const
type WalletDebitType = (typeof WALLET_DEBIT_TYPES)[number]

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

/**
 * Debit reference payload (T-04.2.01.04).
 *
 * `type` is the ledger discriminator; `refId` optionally points at the
 * originating domain entity (invoice, order, …).
 */
export interface WalletDebitRef {
  type: WalletDebitType
  refId?: string | null
  description?: string | null
  metadata?: unknown
}

/**
 * Reservation reference payload (T-04.2.01.05).
 *
 * Optional pointer at the originating domain entity (invoice, order, …)
 * held during the payment flow.
 */
export interface WalletReserveRef {
  refId?: string | null
  description?: string | null
  metadata?: unknown
}

/**
 * Minimal queryable used by the optimistic posted-balance update
 * (T-04.2.01.06). Matches `pg` Pool / PoolClient `query()` so the
 * primitive can run inside a caller-owned transaction or against the
 * shared pool. Tests pass a mock with the same shape.
 */
export interface WalletQueryClient {
  query: (
    text: string,
    params?: unknown[],
  ) => Promise<{ rows: unknown[]; rowCount?: number | null }>
}

@Injectable()
export class WalletService {
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
   * Apply a signed posted-balance delta under optimistic locking
   * (T-04.2.01.06).
   *
   * Executes:
   * ```
   * UPDATE wallets
   * SET posted_balance = posted_balance + delta,
   *     version = version + 1
   * WHERE profile_id = X AND version = expectedVersion
   *   [AND posted_balance >= 0]  -- when requireNonNegativePostedBalance
   * ```
   *
   * The wallets PK is `profile_id` (the task text's `id`). A matching
   * version applies `delta` (positive or negative) and bumps `version`
   * atomically; a stale `expectedVersion` matches zero rows.
   *
   * `requireNonNegativePostedBalance` is the T-04.2.01.03 credit guard:
   * refuse to post onto a wallet whose `posted_balance` is already
   * negative. The default (false) keeps this primitive matching
   * T-04.2.01.06 (`WHERE id = X AND version = expectedVersion` only).
   *
   * This is the locking primitive, not a standalone money-moving
   * command. Callers that change customer funds must also write the
   * matching ledger row in the same transaction (S-04.2.01).
   *
   * Pass `client` to participate in an open transaction; omit it to
   * run against the shared pool.
   *
   * @returns the updated wallet row
   * @throws ConflictException when zero rows match (version mismatch,
   *   missing wallet, or posted_balance < 0 when that guard is on)
   */
  async applyPostedBalanceDelta(
    walletId: string,
    delta: bigint,
    expectedVersion: number,
    client?: WalletQueryClient,
    options?: { requireNonNegativePostedBalance?: boolean },
  ): Promise<WalletRow> {
    if (!walletId.trim()) {
      throw new BadRequestException('Wallet id is required')
    }
    if (delta === 0n) {
      throw new BadRequestException('Posted-balance delta must be non-zero')
    }
    if (!Number.isInteger(expectedVersion) || expectedVersion < 0) {
      throw new BadRequestException('Expected version must be a non-negative integer')
    }

    const postedGuard = options?.requireNonNegativePostedBalance
      ? '\n         AND posted_balance >= 0'
      : ''
    const queryable = client ?? getDbPool()
    const result = await queryable.query(
      `UPDATE wallets
       SET posted_balance = posted_balance + $1::bigint,
           version = version + 1,
           updated_at = NOW()
       WHERE profile_id = $2
         AND version = $3${postedGuard}
       RETURNING *, (posted_balance - reserved_balance) AS available_balance`,
      [delta, walletId, expectedVersion],
    )
    if (result.rows.length === 0) {
      throw new ConflictException('Wallet optimistic lock failed: version mismatch')
    }
    return mapWallet(result.rows[0] as Parameters<typeof mapWallet>[0])
  }

  /**
   * Credit a wallet (T-04.2.01.03).
   *
   * In one DB transaction:
   *   1. `SELECT … FOR UPDATE` the wallet row.
   *   2. Return the existing ledger row when `idempotencyKey` already posted
   *      as the same Completed credit (matching type, amount, and refId).
   *      Collisions with debits, reservations, or a different credit command
   *      throw ConflictException — they must not report success.
   *   3. INSERT a Completed ledger row (positive amount) using the wallet
   *      row's canonical `profile_id`.
   *   4. UPDATE `posted_balance` via `applyPostedBalanceDelta`
   *      (`posted_balance + amount`, `version + 1`,
   *      `WHERE profile_id = X AND version = expectedVersion
   *       AND posted_balance >= 0`).
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
      const wallet = walletResult.rows[0] as {
        version: number
        profile_id: string
      }
      canonicalWalletId = wallet.profile_id

      const idemResult = await client.query(
        `SELECT * FROM wallet_transactions WHERE idempotency_key = $1`,
        [idempotencyKey],
      )
      if (idemResult.rows.length > 0) {
        const existing = idemResult.rows[0]!
        assertMatchingCreditReplay(existing, canonicalWalletId, amount, ref)
        await client.query('COMMIT')
        return mapTransaction(existing)
      }

      const txResult = await client.query(
        `INSERT INTO wallet_transactions
           (wallet_id, type, amount, state, idempotency_key, ref_id, description, metadata)
         VALUES ($1, $2, $3::bigint, 'Completed', $4, $5, $6, COALESCE($7::jsonb, '{}'::jsonb))
         RETURNING *`,
        [
          canonicalWalletId,
          ref.type,
          amount,
          idempotencyKey,
          ref.refId ?? null,
          ref.description ?? null,
          ref.metadata === undefined ? null : JSON.stringify(ref.metadata),
        ],
      )

      try {
        await this.applyPostedBalanceDelta(
          canonicalWalletId,
          amount,
          wallet.version,
          client,
          { requireNonNegativePostedBalance: true },
        )
      } catch (error) {
        if (error instanceof ConflictException) {
          throw new ConflictException(
            'Wallet credit rejected: version mismatch or postedBalance < 0',
          )
        }
        throw error
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
        if (existing.rows.length === 0 || canonicalWalletId === undefined) {
          throw new ConflictException('Idempotency key already used')
        }
        const committed = existing.rows[0]!
        assertMatchingCreditReplay(committed, canonicalWalletId, amount, ref)
        return mapTransaction(committed)
      }
      throw error
    } finally {
      client.release()
    }
  }

  /**
   * Debit a wallet (T-04.2.01.04).
   *
   * In one DB transaction:
   *   1. `SELECT … FOR UPDATE` the wallet row.
   *   2. Return the existing ledger row when `idempotencyKey` already posted
   *      as the same Completed debit (matching type, amount, and refId).
   *      Collisions with credits, reservations, or a different debit command
   *      throw ConflictException — they must not report success.
   *   3. Reject when `availableBalance` (`posted - reserved`) is below `amount`.
   *   4. Atomically reserve (`reserved_balance += amount` with
   *      `WHERE version = X AND available >= amount`) then complete
   *      (`posted_balance -= amount`, `reserved_balance -= amount` with
   *      `WHERE version = X+1`). Both UPDATEs bind the wallet row's
   *      canonical `profile_id`.
   *   5. INSERT a Completed ledger row (negative amount) using the
   *      wallet row's canonical `profile_id`.
   *
   * Unique `idempotency_key` is the last-line duplicate guard.
   */
  async debit(
    walletId: string,
    amount: bigint,
    ref: WalletDebitRef,
    idempotencyKey: string,
  ): Promise<TransactionRow> {
    if (amount <= 0n) throw new BadRequestException('Debit amount must be positive')
    if (!idempotencyKey.trim()) {
      throw new BadRequestException('Idempotency key is required')
    }
    if (!isWalletDebitType(ref.type)) {
      throw new BadRequestException(`Debit type must be one of: ${WALLET_DEBIT_TYPES.join(', ')}`)
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
      const wallet = walletResult.rows[0] as {
        version: number
        profile_id: string
        posted_balance: string | number | bigint
        reserved_balance: string | number | bigint
      }
      canonicalWalletId = wallet.profile_id

      const idemResult = await client.query(
        `SELECT * FROM wallet_transactions WHERE idempotency_key = $1`,
        [idempotencyKey],
      )
      if (idemResult.rows.length > 0) {
        const existing = idemResult.rows[0]!
        assertMatchingDebitReplay(existing, canonicalWalletId, amount, ref)
        await client.query('COMMIT')
        return mapTransaction(existing)
      }

      const posted = BigInt(wallet.posted_balance)
      const reserved = BigInt(wallet.reserved_balance)
      const available = posted - reserved
      if (available < amount) {
        throw new BadRequestException(
          `Insufficient balance: available=${available.toString()}, required=${amount.toString()}`,
        )
      }

      const reserveResult = await client.query(
        `UPDATE wallets
         SET reserved_balance = reserved_balance + $1::bigint,
             version = version + 1,
             updated_at = NOW()
         WHERE profile_id = $2
           AND version = $3
           AND (posted_balance - reserved_balance) >= $1::bigint
         RETURNING *`,
        [amount, canonicalWalletId, wallet.version],
      )
      if (reserveResult.rows.length === 0) {
        throw new ConflictException(
          'Wallet debit reserve rejected: version mismatch or insufficient availableBalance',
        )
      }
      const reservedWallet = reserveResult.rows[0] as { version: number }

      const completeResult = await client.query(
        `UPDATE wallets
         SET posted_balance = posted_balance - $1::bigint,
             reserved_balance = reserved_balance - $1::bigint,
             version = version + 1,
             updated_at = NOW()
         WHERE profile_id = $2
           AND version = $3
           AND reserved_balance >= $1::bigint
           AND posted_balance >= $1::bigint
         RETURNING *`,
        [amount, canonicalWalletId, reservedWallet.version],
      )
      if (completeResult.rows.length === 0) {
        throw new ConflictException(
          'Wallet debit complete rejected: version mismatch or reserved/posted shortfall',
        )
      }

      const txResult = await client.query(
        `INSERT INTO wallet_transactions
           (wallet_id, type, amount, state, idempotency_key, ref_id, description, metadata)
         VALUES ($1, $2, $3::bigint, 'Completed', $4, $5, $6, COALESCE($7::jsonb, '{}'::jsonb))
         RETURNING *`,
        [
          canonicalWalletId,
          ref.type,
          -amount,
          idempotencyKey,
          ref.refId ?? null,
          ref.description ?? null,
          ref.metadata === undefined ? null : JSON.stringify(ref.metadata),
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
        assertMatchingDebitReplay(committed, canonicalWalletId, amount, ref)
        return mapTransaction(committed)
      }
      throw error
    } finally {
      client.release()
    }
  }

  /**
   * Reserve funds on a wallet for a pending payment (T-04.2.01.05).
   *
   * In one DB transaction:
   *   1. `SELECT … FOR UPDATE` the wallet row.
   *   2. Return the existing ledger row when `idempotencyKey` already
   *      posted as the same live reservation (matching type, amount,
   *      and refId in state Reserved). Collisions with credits, debits,
   *      or a released/different reservation throw ConflictException.
   *   3. Reject when `availableBalance` (`posted - reserved`) is below `amount`.
   *   4. UPDATE `reserved_balance` with
   *      `WHERE version = X AND (posted_balance - reserved_balance) >= amount`.
   *   5. INSERT a Reserved ledger row (positive amount, type reservation)
   *      using the wallet row's canonical `profile_id`.
   *
   * Unique `idempotency_key` is the last-line duplicate guard.
   * `idempotencyKey` is required because ledger rows cannot omit it.
   */
  async reserve(
    walletId: string,
    amount: bigint,
    idempotencyKey: string,
    ref?: WalletReserveRef,
  ): Promise<TransactionRow> {
    if (amount <= 0n) throw new BadRequestException('Reserve amount must be positive')
    if (!idempotencyKey.trim()) {
      throw new BadRequestException('Idempotency key is required')
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
      const wallet = walletResult.rows[0] as {
        version: number
        profile_id: string
        posted_balance: string | number | bigint
        reserved_balance: string | number | bigint
      }
      canonicalWalletId = wallet.profile_id

      const idemResult = await client.query(
        `SELECT * FROM wallet_transactions WHERE idempotency_key = $1`,
        [idempotencyKey],
      )
      if (idemResult.rows.length > 0) {
        const existing = idemResult.rows[0]!
        assertMatchingReserveReplay(existing, canonicalWalletId, amount, ref)
        await client.query('COMMIT')
        return mapTransaction(existing)
      }

      const posted = BigInt(wallet.posted_balance)
      const reserved = BigInt(wallet.reserved_balance)
      const available = posted - reserved
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
         WHERE profile_id = $2
           AND version = $3
           AND (posted_balance - reserved_balance) >= $1
         RETURNING *`,
        [amount, canonicalWalletId, wallet.version],
      )
      if (updateResult.rows.length === 0) {
        throw new ConflictException(
          'Wallet reserve rejected: version mismatch or insufficient availableBalance',
        )
      }

      const txResult = await client.query(
        `INSERT INTO wallet_transactions
           (wallet_id, type, amount, state, idempotency_key, ref_id, description, metadata)
         VALUES ($1, 'reservation', $2::bigint, 'Reserved', $3, $4, $5, COALESCE($6::jsonb, '{}'::jsonb))
         RETURNING *`,
        [
          canonicalWalletId,
          amount,
          idempotencyKey,
          ref?.refId ?? null,
          ref?.description ?? null,
          ref?.metadata === undefined ? null : JSON.stringify(ref.metadata),
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
        assertMatchingReserveReplay(committed, canonicalWalletId, amount, ref)
        return mapTransaction(committed)
      }
      throw error
    } finally {
      client.release()
    }
  }

  /**
   * Release a previous reservation (T-04.2.01.05).
   *
   * In one DB transaction:
   *   1. `SELECT … FOR UPDATE` the reservation ledger row.
   *   2. NotFound when missing. Conflict when the row is not a
   *      reservation. Idempotent: a row already in Released is returned
   *      without a second reserved_balance decrement.
   *   3. `SELECT … FOR UPDATE` the wallet.
   *   4. UPDATE `reserved_balance -= amount` with
   *      `WHERE version = X AND reserved_balance >= amount`.
   *   5. Advance the reservation `state` to Released. Posted balance is
   *      unchanged, so available balance rises by the released amount.
   */
  async release(reservationId: string): Promise<TransactionRow> {
    if (!reservationId.trim()) {
      throw new BadRequestException('Reservation id is required')
    }

    const pool = getDbPool()
    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      const reservationResult = await client.query(
        `SELECT * FROM wallet_transactions WHERE id = $1 FOR UPDATE`,
        [reservationId],
      )
      if (reservationResult.rows.length === 0) {
        throw new NotFoundException(`Reservation not found: ${reservationId}`)
      }
      const reservation = reservationResult.rows[0]! as {
        id: string
        wallet_id: string
        type: string
        amount: string | number | bigint
        state: string
      }
      if (reservation.type !== 'reservation') {
        throw new ConflictException('Ledger row is not a reservation')
      }
      if (reservation.state === 'Released') {
        await client.query('COMMIT')
        return mapTransaction(reservationResult.rows[0])
      }
      if (reservation.state !== 'Reserved') {
        throw new ConflictException(
          `Reservation cannot be released from state ${reservation.state}`,
        )
      }

      const amount = BigInt(reservation.amount)
      if (amount <= 0n) {
        throw new ConflictException('Reservation amount must be positive')
      }

      const walletResult = await client.query(
        `SELECT * FROM wallets WHERE profile_id = $1 FOR UPDATE`,
        [reservation.wallet_id],
      )
      if (walletResult.rows.length === 0) {
        throw new NotFoundException(`Wallet not found: ${reservation.wallet_id}`)
      }
      const wallet = walletResult.rows[0] as { version: number; profile_id: string }

      const updateResult = await client.query(
        `UPDATE wallets
         SET reserved_balance = reserved_balance - $1,
             version = version + 1,
             updated_at = NOW()
         WHERE profile_id = $2
           AND version = $3
           AND reserved_balance >= $1
         RETURNING *`,
        [amount, wallet.profile_id, wallet.version],
      )
      if (updateResult.rows.length === 0) {
        throw new ConflictException(
          'Wallet release rejected: version mismatch or reservedBalance shortfall',
        )
      }

      const releasedResult = await client.query(
        `UPDATE wallet_transactions SET state = 'Released' WHERE id = $1 RETURNING *`,
        [reservationId],
      )

      await client.query('COMMIT')
      return mapTransaction(releasedResult.rows[0])
    } catch (error) {
      await client.query('ROLLBACK')
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

function isWalletDebitType(type: string): type is WalletDebitType {
  return (WALLET_DEBIT_TYPES as readonly string[]).includes(type)
}

type WalletLedgerIdempotencyRow = {
  wallet_id: string
  type: string
  amount: string | number | bigint
  state: string
  ref_id?: string | null
}

/**
 * Idempotent credit replay is only valid for the same Completed credit
 * command: same wallet, type, positive amount, and refId. A colliding
 * debit, reservation, or credit with different parameters must not be
 * returned as a successful credit.
 */
function assertMatchingCreditReplay(
  existing: WalletLedgerIdempotencyRow,
  canonicalWalletId: string,
  amount: bigint,
  ref: WalletCreditRef,
): void {
  if (existing.wallet_id !== canonicalWalletId) {
    throw new ConflictException('Idempotency key already used for a different wallet')
  }
  const existingRefId = existing.ref_id ?? null
  const expectedRefId = ref.refId ?? null
  const isSameCredit =
    existing.state === 'Completed' &&
    existing.type === ref.type &&
    BigInt(existing.amount) === amount &&
    existingRefId === expectedRefId
  if (!isSameCredit) {
    throw new ConflictException('Idempotency key already used for a different wallet operation')
  }
}

/**
 * Idempotent debit replay is only valid for the same Completed debit
 * command: same wallet, type, negative amount, and refId. A colliding
 * credit, reservation, or debit with different parameters must not be
 * returned as a successful debit.
 */
function assertMatchingDebitReplay(
  existing: WalletLedgerIdempotencyRow,
  canonicalWalletId: string,
  amount: bigint,
  ref: WalletDebitRef,
): void {
  if (existing.wallet_id !== canonicalWalletId) {
    throw new ConflictException('Idempotency key already used for a different wallet')
  }
  const existingRefId = existing.ref_id ?? null
  const expectedRefId = ref.refId ?? null
  const isSameDebit =
    existing.state === 'Completed' &&
    existing.type === ref.type &&
    BigInt(existing.amount) === -amount &&
    existingRefId === expectedRefId
  if (!isSameDebit) {
    throw new ConflictException('Idempotency key already used for a different wallet operation')
  }
}

/**
 * Idempotent reserve replay is only valid for the same live reservation:
 * same wallet, type reservation, positive amount, refId, and Reserved
 * state. A colliding credit, debit, or released/different reservation
 * must not be returned as a successful hold.
 */
function assertMatchingReserveReplay(
  existing: WalletLedgerIdempotencyRow,
  canonicalWalletId: string,
  amount: bigint,
  ref?: WalletReserveRef,
): void {
  if (existing.wallet_id !== canonicalWalletId) {
    throw new ConflictException('Idempotency key already used for a different wallet')
  }
  const existingRefId = existing.ref_id ?? null
  const expectedRefId = ref?.refId ?? null
  const isSameReservation =
    existing.state === 'Reserved' &&
    existing.type === 'reservation' &&
    BigInt(existing.amount) === amount &&
    existingRefId === expectedRefId
  if (!isSameReservation) {
    throw new ConflictException('Idempotency key already used for a different wallet operation')
  }
}

function isPgUniqueViolation(error: unknown, constraint?: string): boolean {
  if (!error || typeof error !== 'object') return false
  const pgError = error as { code?: string; constraint?: string }
  if (pgError.code !== PG_UNIQUE_VIOLATION) return false
  return constraint === undefined || pgError.constraint === constraint
}
