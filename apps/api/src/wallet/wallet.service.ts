import { Injectable, Logger } from '@nestjs/common'
import { getDbPool } from '@barghsa/db'

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
    const existing = await this.getWallet(profileId)
    if (existing) return existing

    const pool = getDbPool()
    const result = await pool.query(
      `INSERT INTO wallets (profile_id) VALUES ($1)
       ON CONFLICT (profile_id) DO NOTHING
       RETURNING *, (posted_balance - reserved_balance) AS available_balance`,
      [profileId],
    )

    return mapWallet(result.rows[0])
  }

  /**
   * Credit a wallet (money in). Uses optimistic locking and atomic transaction.
   */
  async credit(
    walletId: string,
    amount: bigint,
    ref: { idempotencyKey: string; type: string; refId?: string; description?: string },
  ): Promise<TransactionRow> {
    if (amount <= 0n) throw new Error('Credit amount must be positive')

    const pool = getDbPool()

    // Check idempotency first
    const existing = await pool.query(
      `SELECT * FROM wallet_transactions WHERE idempotency_key = $1`,
      [ref.idempotencyKey],
    )
    if (existing.rows.length > 0) {
      return mapTransaction(existing.rows[0])
    }

    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      const walletResult = await client.query(
        `SELECT * FROM wallets WHERE profile_id = $1 FOR UPDATE`,
        [walletId],
      )
      if (walletResult.rows.length === 0) {
        throw new Error(`Wallet not found: ${walletId}`)
      }
      const wallet = walletResult.rows[0]

      const updateResult = await client.query(
        `UPDATE wallets
         SET posted_balance = posted_balance + $1,
             version = version + 1,
             updated_at = NOW()
         WHERE profile_id = $2 AND version = $3
         RETURNING *`,
        [amount, walletId, wallet.version],
      )
      if (updateResult.rows.length === 0) {
        throw new Error('Concurrent wallet modification detected')
      }

      const txResult = await client.query(
        `INSERT INTO wallet_transactions (wallet_id, type, amount, state, idempotency_key, ref_id, description)
         VALUES ($1, $2, $3, 'Completed', $4, $5, $6)
         RETURNING *`,
        [walletId, ref.type, amount, ref.idempotencyKey, ref.refId ?? null, ref.description ?? null],
      )

      await client.query('COMMIT')
      return mapTransaction(txResult.rows[0])
    } catch (error) {
      await client.query('ROLLBACK')
      this.logger.error(`Credit failed: ${error}`)
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
    if (amount <= 0n) throw new Error('Debit amount must be positive')

    const pool = getDbPool()

    const existing = await pool.query(
      `SELECT * FROM wallet_transactions WHERE idempotency_key = $1`,
      [ref.idempotencyKey],
    )
    if (existing.rows.length > 0) {
      return mapTransaction(existing.rows[0])
    }

    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      const walletResult = await client.query(
        `SELECT * FROM wallets WHERE profile_id = $1 FOR UPDATE`,
        [walletId],
      )
      if (walletResult.rows.length === 0) {
        throw new Error(`Wallet not found: ${walletId}`)
      }
      const wallet = walletResult.rows[0]

      const available = wallet.posted_balance - wallet.reserved_balance
      if (available < amount) {
        throw new Error(
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
        throw new Error('Concurrent wallet modification detected')
      }

      const txResult = await client.query(
        `INSERT INTO wallet_transactions (wallet_id, type, amount, state, idempotency_key, ref_id, description)
         VALUES ($1, $2, $3::bigint, 'Completed', $4, $5, $6)
         RETURNING *`,
        [walletId, ref.type, -amount, ref.idempotencyKey, ref.refId ?? null, ref.description ?? null],
      )

      await client.query('COMMIT')
      return mapTransaction(txResult.rows[0])
    } catch (error) {
      await client.query('ROLLBACK')
      this.logger.error(`Debit failed: ${error}`)
      throw error
    } finally {
      client.release()
    }
  }

  /**
   * Reserve amount in wallet for pending payment. Reduces available balance.
   */
  async reserve(walletId: string, amount: bigint, idempotencyKey: string): Promise<TransactionRow> {
    if (amount <= 0n) throw new Error('Reserve amount must be positive')

    const pool = getDbPool()

    const existing = await pool.query(
      `SELECT * FROM wallet_transactions WHERE idempotency_key = $1`,
      [idempotencyKey],
    )
    if (existing.rows.length > 0) return mapTransaction(existing.rows[0])

    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      const walletResult = await client.query(
        `SELECT * FROM wallets WHERE profile_id = $1 FOR UPDATE`,
        [walletId],
      )
      if (walletResult.rows.length === 0) {
        throw new Error(`Wallet not found: ${walletId}`)
      }
      const wallet = walletResult.rows[0]

      const available = wallet.posted_balance - wallet.reserved_balance
      if (available < amount) {
        throw new Error(
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
        throw new Error('Concurrent wallet modification detected')
      }

      const txResult = await client.query(
        `INSERT INTO wallet_transactions (wallet_id, type, amount, state, idempotency_key)
         VALUES ($1, 'reservation', $2, 'Reserved', $3)
         RETURNING *`,
        [walletId, amount, idempotencyKey],
      )

      await client.query('COMMIT')
      return mapTransaction(txResult.rows[0])
    } catch (error) {
      await client.query('ROLLBACK')
      this.logger.error(`Reserve failed: ${error}`)
      throw error
    } finally {
      client.release()
    }
  }

  /**
   * Release a previous reservation. Reduces reserved balance without affecting posted balance.
   */
  async release(reservationId: string): Promise<{ released: boolean; walletId: string; amount: bigint }> {
    const pool = getDbPool()

    const reservationResult = await pool.query(
      `SELECT * FROM wallet_transactions WHERE id = $1`,
      [reservationId],
    )
    if (reservationResult.rows.length === 0) {
      throw new Error(`Reservation not found: ${reservationId}`)
    }
    const reservation = reservationResult.rows[0]!
    if (reservation.state !== 'Reserved') {
      throw new Error(`Reservation ${reservationId} is not in Reserved state`)
    }

    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      const walletResult = await client.query(
        `SELECT * FROM wallets WHERE profile_id = $1 FOR UPDATE`,
        [reservation.wallet_id],
      )
      const wallet = walletResult.rows[0]

      await client.query(
        `UPDATE wallets
         SET reserved_balance = reserved_balance - $1,
             version = version + 1,
             updated_at = NOW()
         WHERE profile_id = $2 AND version = $3`,
        [reservation.amount, reservation.wallet_id, wallet.version],
      )

      await client.query(
        `UPDATE wallet_transactions SET state = 'Released' WHERE id = $1`,
        [reservationId],
      )

      await client.query('COMMIT')
      return { released: true, walletId: reservation.wallet_id, amount: reservation.amount }
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
