import { sql } from 'drizzle-orm'
import { text, boolean, jsonb, integer, pgTable, uniqueIndex } from 'drizzle-orm/pg-core'
import { uuidv7, irrAmount, timestamptz } from '../types'
import { profiles } from './profiles'

/**
 * Wallet table (T-04.2.01.01).
 *
 * One wallet per customer profile (Individual or Legal). Three derived balances:
 *   - `postedBalance` — sum of all completed credits minus completed debits
 *   - `reservedBalance` — sum of all pending/active reservations
 *   - `availableBalance` = postedBalance - reservedBalance (derived at query time, NOT stored)
 *
 * Optimistic locking via `version` column — every mutation increments it.
 *
 * Columns:
 *   - `profileId` — PK, FK → profiles.id (one wallet per profile).
 *   - `postedBalance` — int8, default 0. Cumulative net balance.
 *   - `reservedBalance` — int8, default 0. Amount reserved in payment flow.
 *   - `version` — monotonic optimistic lock integer.
 *   - `updatedAt` — last mutation timestamp.
 */
export const wallets = pgTable(
  'wallets',
  {
    /** Primary key = profile id. One wallet per profile. */
    profileId: text('profile_id')
      .primaryKey()
      .notNull()
      .references(() => profiles.id, { onDelete: 'restrict' }),

    /** Sum of all completed credits minus completed debits. IRR, stored as int8. */
    postedBalance: irrAmount('posted_balance').notNull().default(sql`0::bigint`),

    /** Sum of all active reservations. IRR, stored as int8. */
    reservedBalance: irrAmount('reserved_balance').notNull().default(sql`0::bigint`),

    /**
     * Optimistic lock version. Incremented on every mutation.
     * Application checks `WHERE version = expectedVersion` on UPDATE.
     */
    version: integer('version').notNull().default(0),

    /** When the wallet was last modified. */
    updatedAt: timestamptz('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
)

/**
 * Wallet transaction ledger table (T-04.2.01.02).
 *
 * Every balance change is a ledger entry. Immutable after creation —
 * corrections use compensating transactions rather than UPDATE/DELETE.
 *
 * Columns:
 *   - `id` — UUIDv7 primary key.
 *   - `walletId` — FK → wallets.profileId.
 *   - `type` — transaction type discriminator.
 *   - `amount` — int8; positive for credit, negative for debit.
 *   - `state` — lifecycle state.
 *   - `idempotencyKey` — unique per transaction, prevents duplicate processing.
 *   - `refId` — optional reference to related domain entity (invoice, order, etc.).
 *   - `description` — optional human-readable description.
 *   - `metadata` — JSONB for extensible structured data.
 *   - `createdAt` / `updatedAt` — audit columns.
 */
export const walletTransactions = pgTable(
  'wallet_transactions',
  {
    /** UUIDv7 opaque transaction identifier. */
    id: uuidv7('id').primaryKey().notNull(),

    /** Foreign key to the wallet (profile). */
    walletId: text('wallet_id')
      .notNull()
      .references(() => wallets.profileId, { onDelete: 'restrict' }),

    /** Transaction type discriminator. */
    type: text('type', {
      enum: ['topup', 'payment', 'refund', 'reservation', 'release', 'reversal', 'compensating'],
    }).notNull(),

    /**
     * Amount in IRR (int8). Positive for credits (money in),
     * negative for debits (money out). Never zero.
     */
    amount: irrAmount('amount').notNull(),

    /** Transaction lifecycle state. */
    state: text('state', {
      enum: ['Pending', 'Reserved', 'Completed', 'Failed', 'Rejected', 'Released', 'Reversed'],
    })
      .notNull()
      .default('Pending'),

    /**
     * Unique idempotency key. Prevents duplicate processing.
     * Unique index ensures at-most-once semantics.
     */
    idempotencyKey: text('idempotency_key').notNull(),

    /** Optional reference to a related domain entity (invoice ID, order ID, etc.). */
    refId: text('ref_id'),

    /** Optional human-readable description of the transaction. */
    description: text('description'),

    /** Extensible metadata payload. */
    metadata: jsonb('metadata'),

    /** When the transaction was created. */
    createdAt: timestamptz('created_at')
      .defaultNow()
      .notNull(),

    /** When the transaction was last updated. */
    updatedAt: timestamptz('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    /** Enforce idempotency: duplicate key detection. */
    idempotencyUniqueIdx: uniqueIndex('idx_wallet_tx_idempotency')
      .on(table.idempotencyKey),
  }),
)

/**
 * SQL to create the wallets table.
 */
export const createWalletsTable = sql`
  CREATE TABLE IF NOT EXISTS wallets (
    profile_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE RESTRICT,
    posted_balance BIGINT NOT NULL DEFAULT 0,
    reserved_balance BIGINT NOT NULL DEFAULT 0,
    version INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  -- Non-negative derived-balance constraint enforced via trigger
  -- (available_balance = posted_balance - reserved_balance must be >= 0)
  CREATE OR REPLACE FUNCTION check_wallet_available_balance()
  RETURNS TRIGGER AS $$
  BEGIN
    IF (NEW.posted_balance - NEW.reserved_balance) < 0 THEN
      RAISE EXCEPTION 'available_balance cannot be negative: posted=% reserved=%',
        NEW.posted_balance, NEW.reserved_balance;
    END IF;
    RETURN NEW;
  END;
  $$ LANGUAGE plpgsql;

  CREATE OR REPLACE TRIGGER trg_wallet_available_balance
    BEFORE INSERT OR UPDATE ON wallets
    FOR EACH ROW EXECUTE FUNCTION check_wallet_available_balance();
`

/**
 * SQL to create the wallet_transactions table.
 */
export const createWalletTransactionsTable = sql`
  CREATE TABLE IF NOT EXISTS wallet_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
    wallet_id UUID NOT NULL REFERENCES wallets(profile_id) ON DELETE RESTRICT,
    type TEXT NOT NULL CHECK (type IN ('topup', 'payment', 'refund', 'reservation', 'release', 'reversal', 'compensating')),
    amount BIGINT NOT NULL CHECK (amount <> 0),
    state TEXT NOT NULL DEFAULT 'Pending' CHECK (state IN ('Pending', 'Reserved', 'Completed', 'Failed', 'Rejected', 'Released', 'Reversed')),
    idempotency_key TEXT NOT NULL,
    ref_id TEXT,
    description TEXT,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_wallet_tx_wallet_id ON wallet_transactions (wallet_id);
  CREATE INDEX IF NOT EXISTS idx_wallet_tx_state ON wallet_transactions (state);
  CREATE INDEX IF NOT EXISTS idx_wallet_tx_type ON wallet_transactions (type);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_wallet_tx_idempotency ON wallet_transactions (idempotency_key);
`
