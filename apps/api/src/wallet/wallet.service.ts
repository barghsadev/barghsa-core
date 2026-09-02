import { Injectable, Optional, BadRequestException, ConflictException, NotFoundException } from '@nestjs/common'
import { getDbPool } from '@barghsa/db'
import {
  WALLET_TOP_UP_LIMIT_CONFIG_KEY,
  WALLET_TOP_UP_LIMIT_LOCK_NAMESPACE,
  DEFAULT_WALLET_TOP_UP_LIMIT_CONFIG,
  toWalletTopUpLimitConfig,
  toOnlineTopUpLimitSnapshot,
  isOnlineWalletTopUpAllowed,
  isValidWalletTopUpLimit,
  onlineTopUpLimitExceededMessage,
  type OnlineTopUpLimitSnapshot,
  WALLET_REVERSAL_ERRORS,
  WALLET_REVERSAL_POSTED_STATE,
  WALLET_REVERSAL_TYPE,
  WALLET_TX_REVERSES_CONSTRAINT,
  availableCoversReversal,
  availableRequiredForReversal,
  isMatchingReversalReplay,
  isReversibleWalletLedgerState,
  isReversibleWalletLedgerType,
  isWalletTransactionUuid,
  reversalAmount,
  walletReversalMetadata,
} from '@barghsa/shared/finance'
import { ConfigCacheService } from '../config-cache/config-cache.service.js'

const PG_UNIQUE_VIOLATION = '23505'
const WALLET_TX_IDEMPOTENCY_CONSTRAINT = 'idx_wallet_tx_idempotency'

/** Ledger types that post as a credit (positive amount, money in). */
const WALLET_CREDIT_TYPES = ['topup', 'refund', 'compensating'] as const
type WalletCreditType = (typeof WALLET_CREDIT_TYPES)[number]

/** Ledger types that post as a debit (negative amount, money out). */
const WALLET_DEBIT_TYPES = ['payment', 'compensating'] as const
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
  reversesTransactionId: string | null
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
  constructor(
    @Optional() private readonly configCache?: ConfigCacheService,
  ) {}

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
   * `requireAvailableAtLeast` is the T-04.2.04.01 reversal debit guard:
   * refuse when derived available balance cannot cover a posted debit.
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
   *   missing wallet, posted_balance < 0, or available shortfall)
   */
  async applyPostedBalanceDelta(
    walletId: string,
    delta: bigint,
    expectedVersion: number,
    client?: WalletQueryClient,
    options?: {
      requireNonNegativePostedBalance?: boolean
      requireAvailableAtLeast?: bigint
    },
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
    const availableFloor = options?.requireAvailableAtLeast
    const availableGuard =
      availableFloor !== undefined
        ? '\n         AND (posted_balance - reserved_balance) >= $4::bigint'
        : ''
    const params: unknown[] =
      availableFloor !== undefined
        ? [delta, walletId, expectedVersion, availableFloor]
        : [delta, walletId, expectedVersion]
    const queryable = client ?? getDbPool()
    const result = await queryable.query(
      `UPDATE wallets
       SET posted_balance = posted_balance + $1::bigint,
           version = version + 1,
           updated_at = NOW()
       WHERE profile_id = $2
         AND version = $3${postedGuard}${availableGuard}
       RETURNING *, (posted_balance - reserved_balance) AS available_balance`,
      params,
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
   *
   * Pass `client` to participate in an open caller-owned transaction
   * (no BEGIN/COMMIT/ROLLBACK/release). Omit it to run against a
   * dedicated pool connection with its own transaction.
   */
  async credit(
    walletId: string,
    amount: bigint,
    ref: WalletCreditRef,
    idempotencyKey: string,
    client?: WalletQueryClient,
  ): Promise<TransactionRow> {
    if (amount <= 0n) throw new BadRequestException('Credit amount must be positive')
    if (!idempotencyKey.trim()) {
      throw new BadRequestException('Idempotency key is required')
    }
    assertNotReversalLedgerType(ref.type)
    if (!isWalletCreditType(ref.type)) {
      throw new BadRequestException(`Credit type must be one of: ${WALLET_CREDIT_TYPES.join(', ')}`)
    }

    const pool = getDbPool()
    const ownsTransaction = client === undefined
    const ownedClient = ownsTransaction ? await pool.connect() : undefined
    const queryable: WalletQueryClient = client ?? ownedClient!
    // PostgreSQL UUID columns return canonical lowercase; callers may pass
    // any valid spelling. Ownership checks must use the row's profile_id.
    let canonicalWalletId: string | undefined
    try {
      if (ownsTransaction) {
        await queryable.query('BEGIN')
      }

      const walletResult = await queryable.query(
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

      const idemResult = await queryable.query(
        `SELECT * FROM wallet_transactions WHERE idempotency_key = $1`,
        [idempotencyKey],
      )
      if (idemResult.rows.length > 0) {
        const existing = idemResult.rows[0] as WalletLedgerIdempotencyRow
        assertMatchingCreditReplay(existing, canonicalWalletId, amount, ref)
        if (ownsTransaction) {
          await queryable.query('COMMIT')
        }
        return mapTransaction(existing)
      }

      const txResult = await queryable.query(
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
          queryable,
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

      if (ownsTransaction) {
        await queryable.query('COMMIT')
      }
      return mapTransaction(txResult.rows[0])
    } catch (error) {
      if (ownsTransaction) {
        await queryable.query('ROLLBACK')
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
      }
      throw error
    } finally {
      ownedClient?.release()
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
   *
   * Pass `client` to participate in an open caller-owned transaction
   * (no BEGIN/COMMIT/ROLLBACK/release). Omit it to run against a
   * dedicated pool connection with its own transaction.
   */
  async debit(
    walletId: string,
    amount: bigint,
    ref: WalletDebitRef,
    idempotencyKey: string,
    client?: WalletQueryClient,
  ): Promise<TransactionRow> {
    if (amount <= 0n) throw new BadRequestException('Debit amount must be positive')
    if (!idempotencyKey.trim()) {
      throw new BadRequestException('Idempotency key is required')
    }
    assertNotReversalLedgerType(ref.type)
    if (!isWalletDebitType(ref.type)) {
      throw new BadRequestException(`Debit type must be one of: ${WALLET_DEBIT_TYPES.join(', ')}`)
    }

    const pool = getDbPool()
    const ownsTransaction = client === undefined
    const ownedClient = ownsTransaction ? await pool.connect() : undefined
    const queryable: WalletQueryClient = client ?? ownedClient!
    // PostgreSQL UUID columns return canonical lowercase; callers may pass
    // any valid spelling. Ownership checks must use the row's profile_id.
    let canonicalWalletId: string | undefined
    try {
      if (ownsTransaction) {
        await queryable.query('BEGIN')
      }

      const walletResult = await queryable.query(
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

      const idemResult = await queryable.query(
        `SELECT * FROM wallet_transactions WHERE idempotency_key = $1`,
        [idempotencyKey],
      )
      if (idemResult.rows.length > 0) {
        const existing = idemResult.rows[0] as WalletLedgerIdempotencyRow
        assertMatchingDebitReplay(existing, canonicalWalletId, amount, ref)
        if (ownsTransaction) {
          await queryable.query('COMMIT')
        }
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

      const reserveResult = await queryable.query(
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

      const completeResult = await queryable.query(
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

      const txResult = await queryable.query(
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

      if (ownsTransaction) {
        await queryable.query('COMMIT')
      }
      return mapTransaction(txResult.rows[0])
    } catch (error) {
      if (ownsTransaction) {
        await queryable.query('ROLLBACK')
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
      }
      throw error
    } finally {
      ownedClient?.release()
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
   *      `WHERE profile_id = canonical AND version = X
   *       AND (posted_balance - reserved_balance) >= amount`.
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
         SET reserved_balance = reserved_balance + $1::bigint,
             version = version + 1,
             updated_at = NOW()
         WHERE profile_id = $2
           AND version = $3
           AND (posted_balance - reserved_balance) >= $1::bigint
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
   *      `WHERE profile_id = canonical AND version = X
   *       AND reserved_balance >= amount`.
   *   5. Advance the reservation `state` to Released using the locked
   *      row's canonical `id`. Posted balance is unchanged, so available
   *      balance rises by the released amount.
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
      // PostgreSQL UUID columns return canonical lowercase; callers may pass
      // any valid spelling. Mutations must use the locked row's id.
      const canonicalReservationId = reservation.id
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
      const canonicalWalletId = wallet.profile_id

      const updateResult = await client.query(
        `UPDATE wallets
         SET reserved_balance = reserved_balance - $1::bigint,
             version = version + 1,
             updated_at = NOW()
         WHERE profile_id = $2
           AND version = $3
           AND reserved_balance >= $1::bigint
         RETURNING *`,
        [amount, canonicalWalletId, wallet.version],
      )
      if (updateResult.rows.length === 0) {
        throw new ConflictException(
          'Wallet release rejected: version mismatch or reservedBalance shortfall',
        )
      }

      const releasedResult = await client.query(
        `UPDATE wallet_transactions
         SET state = 'Released'
         WHERE id = $1
           AND type = 'reservation'
           AND state = 'Reserved'
         RETURNING *`,
        [canonicalReservationId],
      )
      if (releasedResult.rows.length === 0) {
        throw new ConflictException(
          'Wallet release rejected: reservation state changed concurrently',
        )
      }

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
   * Reverse a posted ledger row (T-04.2.04.01 / S-04.2.04).
   *
   * Never rewrites the original amount. In one DB transaction:
   *   1. `SELECT … FOR UPDATE` the original ledger row, then the wallet.
   *   2. Return the existing reversal when `idempotencyKey` already posted
   *      the same Completed compensating row (matching original, amount,
   *      and reason). Collisions throw ConflictException.
   *   3. Refuse a second reversal of the same original (unique
   *      `reverses_transaction_id`).
   *   4. INSERT a Completed `reversal` row with the opposite signed amount.
   *   5. UPDATE `posted_balance` by that same delta under optimistic
   *      locking. Reversing a credit also requires
   *      `availableBalance >= original.amount`.
   *
   * `credit()` and `debit()` refuse `type: 'reversal'`. This method is
   * the only WalletService writer for compensating reversal rows, so the
   * unique original pointer cannot be skipped.
   *
   * Pass `client` to participate in an open caller-owned transaction
   * (no BEGIN/COMMIT/ROLLBACK/release). Omit it to run against a
   * dedicated pool connection with its own transaction.
   */
  async reverseTransaction(
    originalTransactionId: string,
    reason: string,
    idempotencyKey: string,
    client?: WalletQueryClient,
  ): Promise<TransactionRow> {
    const trimmedReason = reason.trim()
    if (!isWalletTransactionUuid(originalTransactionId)) {
      throw new BadRequestException(WALLET_REVERSAL_ERRORS.ORIGINAL_ID_REQUIRED())
    }
    if (!trimmedReason) {
      throw new BadRequestException(WALLET_REVERSAL_ERRORS.REASON_REQUIRED())
    }
    if (!idempotencyKey.trim()) {
      throw new BadRequestException(WALLET_REVERSAL_ERRORS.IDEMPOTENCY_REQUIRED())
    }

    const pool = getDbPool()
    const ownsTransaction = client === undefined
    const ownedClient = ownsTransaction ? await pool.connect() : undefined
    const queryable: WalletQueryClient = client ?? ownedClient!
    let canonicalWalletId: string | undefined
    let canonicalOriginalId: string | undefined
    let originalAmount: bigint | undefined
    try {
      if (ownsTransaction) {
        await queryable.query('BEGIN')
      }

      const originalResult = await queryable.query(
        `SELECT * FROM wallet_transactions WHERE id = $1 FOR UPDATE`,
        [originalTransactionId],
      )
      if (originalResult.rows.length === 0) {
        throw new NotFoundException(WALLET_REVERSAL_ERRORS.NOT_FOUND(originalTransactionId))
      }
      const original = originalResult.rows[0] as {
        id: string
        wallet_id: string
        type: string
        amount: string | number | bigint
        state: string
        ref_id: string | null
      }
      canonicalOriginalId = original.id
      originalAmount = BigInt(original.amount)

      if (!isReversibleWalletLedgerType(original.type)) {
        throw new BadRequestException(WALLET_REVERSAL_ERRORS.NOT_REVERSIBLE_TYPE(original.type))
      }
      if (!isReversibleWalletLedgerState(original.state)) {
        throw new ConflictException(WALLET_REVERSAL_ERRORS.NOT_REVERSIBLE_STATE(original.state))
      }

      const walletResult = await queryable.query(
        `SELECT * FROM wallets WHERE profile_id = $1 FOR UPDATE`,
        [original.wallet_id],
      )
      if (walletResult.rows.length === 0) {
        throw new NotFoundException(`Wallet not found: ${original.wallet_id}`)
      }
      const wallet = walletResult.rows[0] as {
        version: number
        profile_id: string
        posted_balance: string | number | bigint
        reserved_balance: string | number | bigint
      }
      canonicalWalletId = wallet.profile_id

      const idemResult = await queryable.query(
        `SELECT * FROM wallet_transactions WHERE idempotency_key = $1`,
        [idempotencyKey],
      )
      if (idemResult.rows.length > 0) {
        const existing = idemResult.rows[0] as WalletLedgerIdempotencyRow
        assertMatchingReversalReplay(
          existing,
          canonicalWalletId,
          canonicalOriginalId,
          originalAmount,
          trimmedReason,
        )
        if (ownsTransaction) {
          await queryable.query('COMMIT')
        }
        return mapTransaction(existing)
      }

      const existingReversal = await queryable.query(
        `SELECT id FROM wallet_transactions WHERE reverses_transaction_id = $1`,
        [canonicalOriginalId],
      )
      if (existingReversal.rows.length > 0) {
        throw new ConflictException(WALLET_REVERSAL_ERRORS.ALREADY_REVERSED(canonicalOriginalId))
      }

      const posted = BigInt(wallet.posted_balance)
      const reserved = BigInt(wallet.reserved_balance)
      const available = posted - reserved
      if (!availableCoversReversal(available, originalAmount)) {
        throw new BadRequestException(
          WALLET_REVERSAL_ERRORS.INSUFFICIENT_BALANCE(
            available,
            availableRequiredForReversal(originalAmount),
          ),
        )
      }

      const compensatingAmount = reversalAmount(originalAmount)
      const metadata = walletReversalMetadata({
        originalTransactionId: canonicalOriginalId,
        originalType: original.type,
        originalAmount,
        originalRefId: original.ref_id,
        reason: trimmedReason,
      })

      const txResult = await queryable.query(
        `INSERT INTO wallet_transactions
           (wallet_id, type, amount, state, idempotency_key, ref_id, description, metadata, reverses_transaction_id)
         VALUES ($1, $2, $3::bigint, $4, $5, $6, $7, COALESCE($8::jsonb, '{}'::jsonb), $9)
         RETURNING *`,
        [
          canonicalWalletId,
          WALLET_REVERSAL_TYPE,
          compensatingAmount,
          WALLET_REVERSAL_POSTED_STATE,
          idempotencyKey,
          original.ref_id,
          trimmedReason,
          JSON.stringify(metadata),
          canonicalOriginalId,
        ],
      )

      const availableFloor = availableRequiredForReversal(originalAmount)
      try {
        await this.applyPostedBalanceDelta(
          canonicalWalletId,
          compensatingAmount,
          wallet.version,
          queryable,
          {
            requireNonNegativePostedBalance: true,
            ...(availableFloor > 0n ? { requireAvailableAtLeast: availableFloor } : {}),
          },
        )
      } catch (error) {
        if (error instanceof ConflictException) {
          throw new ConflictException(
            'Wallet reversal rejected: version mismatch or availableBalance shortfall',
          )
        }
        throw error
      }

      if (ownsTransaction) {
        await queryable.query('COMMIT')
      }
      return mapTransaction(txResult.rows[0])
    } catch (error) {
      if (ownsTransaction) {
        await queryable.query('ROLLBACK')
        if (
          canonicalWalletId !== undefined &&
          canonicalOriginalId !== undefined &&
          originalAmount !== undefined &&
          (isPgUniqueViolation(error, WALLET_TX_IDEMPOTENCY_CONSTRAINT) ||
            isPgUniqueViolation(error, WALLET_TX_REVERSES_CONSTRAINT))
        ) {
          const existing = await pool.query(
            `SELECT * FROM wallet_transactions WHERE idempotency_key = $1`,
            [idempotencyKey],
          )
          if (existing.rows.length > 0) {
            const committed = existing.rows[0]!
            assertMatchingReversalReplay(
              committed,
              canonicalWalletId,
              canonicalOriginalId,
              originalAmount,
              trimmedReason,
            )
            return mapTransaction(committed)
          }
          if (isPgUniqueViolation(error, WALLET_TX_REVERSES_CONSTRAINT)) {
            throw new ConflictException(
              WALLET_REVERSAL_ERRORS.ALREADY_REVERSED(canonicalOriginalId),
            )
          }
          throw new ConflictException('Idempotency key already used')
        }
      }
      throw error
    } finally {
      ownedClient?.release()
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
   * Resolve the versioned admin `onlineTopUpLimit` (T-04.2.02.06).
   *
   * When `client` is supplied (the submission transaction), an always-present
   * transaction-scoped advisory lock is taken before `SELECT … FOR UPDATE`.
   * `FOR UPDATE` locks nothing when the key is absent, so the advisory lock
   * is what serializes a first admin write against this read. Otherwise the
   * versioned config cache is used, falling back to a plain `app_config`
   * read. Missing rows serve the 2e9 IRR default at config version `0`.
   */
  async resolveOnlineTopUpLimit(client?: WalletQueryClient): Promise<OnlineTopUpLimitSnapshot> {
    if (client) {
      await client.query(
        `SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))`,
        [WALLET_TOP_UP_LIMIT_LOCK_NAMESPACE, WALLET_TOP_UP_LIMIT_CONFIG_KEY],
      )
      const result = await client.query(
        `SELECT value, version FROM app_config WHERE key = $1 FOR UPDATE`,
        [WALLET_TOP_UP_LIMIT_CONFIG_KEY],
      )
      return snapshotFromConfigRow(result.rows[0])
    }

    if (this.configCache) {
      const fetched = await this.configCache.getWithVersion<unknown>(WALLET_TOP_UP_LIMIT_CONFIG_KEY)
      if (fetched.value == null) {
        return toOnlineTopUpLimitSnapshot({ ...DEFAULT_WALLET_TOP_UP_LIMIT_CONFIG }, 0)
      }
      return snapshotFromConfigValue(fetched.value, fetched.version)
    }

    const pool = getDbPool()
    const result = await pool.query(
      `SELECT value, version FROM app_config WHERE key = $1`,
      [WALLET_TOP_UP_LIMIT_CONFIG_KEY],
    )
    return snapshotFromConfigRow(result.rows[0])
  }

  /**
   * Enforce the admin-configured per-transaction online wallet top-up limit
   * (T-09.10.01 / T-04.2.02.06).
   *
   * The online top-up initiation flow must call this **before** creating a
   * Pending top-up, and again inside the submission transaction so the
   * locked versioned config is the ceiling that is snapshotted onto the
   * ledger row. Rejects amounts over the current `onlineTopUpLimit` with
   * a 400 whose body includes the versioned snapshot that was enforced, so
   * the customer form can refresh the advertised ceiling and retry with a
   * reduced amount.
   *
   * @returns the versioned snapshot that was enforced
   * @throws BadRequestException when the amount is non-positive or exceeds
   *   the configured limit.
   */
  async validateOnlineTopUpAmount(
    amountIrR: bigint,
    client?: WalletQueryClient,
  ): Promise<OnlineTopUpLimitSnapshot> {
    if (amountIrR <= 0n) {
      throw new BadRequestException('Online top-up amount must be positive')
    }
    const snapshot = await this.resolveOnlineTopUpLimit(client)
    if (!isOnlineWalletTopUpAllowed({ limitIrR: snapshot.onlineTopUpLimit }, amountIrR)) {
      throw new BadRequestException({
        message: onlineTopUpLimitExceededMessage(amountIrR, snapshot),
        onlineTopUpLimit: snapshot.onlineTopUpLimit,
        configVersion: snapshot.configVersion,
      })
    }
    return snapshot
  }
}

function snapshotFromConfigRow(row: unknown): OnlineTopUpLimitSnapshot {
  if (!row || typeof row !== 'object') {
    return toOnlineTopUpLimitSnapshot({ ...DEFAULT_WALLET_TOP_UP_LIMIT_CONFIG }, 0)
  }
  const rec = row as { value?: unknown; version?: unknown }
  return snapshotFromConfigValue(rec.value, rec.version)
}

function snapshotFromConfigValue(
  value: unknown,
  version: unknown,
): OnlineTopUpLimitSnapshot {
  const config = toWalletTopUpLimitConfig(value)
  const persisted =
    value && typeof value === 'object'
      ? (value as Record<string, unknown>).limit_irr ?? (value as Record<string, unknown>).limitIrR
      : undefined
  if (persisted !== undefined && !isValidWalletTopUpLimit(persisted)) {
    return toOnlineTopUpLimitSnapshot({ ...DEFAULT_WALLET_TOP_UP_LIMIT_CONFIG }, 0)
  }
  const numericVersion = typeof version === 'number' ? version : Number(version)
  return toOnlineTopUpLimitSnapshot(config, Number.isFinite(numericVersion) ? numericVersion : 0)
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
    reversesTransactionId: row.reverses_transaction_id ?? null,
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

/**
 * `reversal` rows are compensating corrections of a specific original
 * (T-04.2.04.01). credit()/debit() must not post them without the unique
 * `reverses_transaction_id` pointer reverseTransaction maintains.
 */
function assertNotReversalLedgerType(type: string): void {
  if (type === WALLET_REVERSAL_TYPE) {
    throw new BadRequestException(WALLET_REVERSAL_ERRORS.USE_REVERSE_TRANSACTION())
  }
}

type WalletLedgerIdempotencyRow = {
  wallet_id: string
  type: string
  amount: string | number | bigint
  state: string
  ref_id?: string | null
  description?: string | null
  reverses_transaction_id?: string | null
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

/**
 * Idempotent reversal replay is only valid for the same Completed
 * compensating row of the same original.
 */
function assertMatchingReversalReplay(
  existing: WalletLedgerIdempotencyRow,
  canonicalWalletId: string,
  originalTransactionId: string,
  originalAmount: bigint,
  reason: string,
): void {
  if (existing.wallet_id !== canonicalWalletId) {
    throw new ConflictException(WALLET_REVERSAL_ERRORS.IDEMPOTENCY_WALLET())
  }
  const matches = isMatchingReversalReplay(
    {
      walletId: existing.wallet_id,
      type: existing.type,
      amount: BigInt(existing.amount),
      state: existing.state,
      reversesTransactionId: existing.reverses_transaction_id ?? null,
      description: existing.description ?? null,
    },
    {
      walletId: canonicalWalletId,
      originalTransactionId,
      originalAmount,
      reason,
    },
  )
  if (!matches) {
    throw new ConflictException(WALLET_REVERSAL_ERRORS.IDEMPOTENCY_COLLISION())
  }
}

function isPgUniqueViolation(error: unknown, constraint?: string): boolean {
  if (!error || typeof error !== 'object') return false
  const pgError = error as { code?: string; constraint?: string }
  if (pgError.code !== PG_UNIQUE_VIOLATION) return false
  return constraint === undefined || pgError.constraint === constraint
}
