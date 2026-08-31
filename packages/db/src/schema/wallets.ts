import { sql } from 'drizzle-orm'
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
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
 * Ledger type discriminator (T-04.2.01.02 / S-04.2.01).
 *
 * Must stay in lock-step with `chk_wallet_transactions_type` in migration 0068.
 */
export const WALLET_TRANSACTION_TYPES = [
  'topup',
  'payment',
  'refund',
  'reservation',
  'release',
  'reversal',
  'compensating',
] as const
export type WalletTransactionType = (typeof WALLET_TRANSACTION_TYPES)[number]

/**
 * Ledger lifecycle states (T-04.2.01.02 / S-04.2.01).
 *
 * Must stay in lock-step with `chk_wallet_transactions_state` in migration 0068.
 */
export const WALLET_TRANSACTION_STATES = [
  'Pending',
  'Reserved',
  'Completed',
  'Failed',
  'Rejected',
  'Released',
  'Reversed',
] as const
export type WalletTransactionState = (typeof WALLET_TRANSACTION_STATES)[number]

/**
 * Wallet transaction ledger table (T-04.2.01.02).
 *
 * Every balance change is a ledger entry. Rows are not hard-deleted;
 * corrections use compensating transactions rather than rewriting amounts.
 * Lifecycle `state` may advance (e.g. Reserved → Released).
 *
 * Columns:
 *   - `id` — UUIDv7 primary key.
 *   - `walletId` — FK → wallets.profileId (RESTRICT).
 *   - `type` — transaction type discriminator.
 *   - `amount` — int8; positive for credit, negative for debit; never zero.
 *   - `state` — lifecycle state (default Pending).
 *   - `idempotencyKey` — unique per transaction, prevents duplicate processing.
 *   - `refId?` — optional reference to related domain entity (invoice, order, etc.).
 *   - `description?` — optional human-readable description.
 *   - `metadata` — JSONB for extensible structured data (default {}).
 *   - `createdAt` / `updatedAt` — audit columns.
 *
 * CHECKs, lookup indexes, the unique idempotency index, and the
 * `updated_at` trigger live in migration 0068 (and are mirrored here).
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
      enum: WALLET_TRANSACTION_TYPES,
    }).notNull(),

    /**
     * Amount in IRR (int8). Positive for credits (money in),
     * negative for debits (money out). Never zero.
     */
    amount: irrAmount('amount').notNull(),

    /** Transaction lifecycle state. */
    state: text('state', {
      enum: WALLET_TRANSACTION_STATES,
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
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),

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
    typeCheck: check(
      'chk_wallet_transactions_type',
      sql`${table.type} IN ('topup', 'payment', 'refund', 'reservation', 'release', 'reversal', 'compensating')`,
    ),
    stateCheck: check(
      'chk_wallet_transactions_state',
      sql`${table.state} IN ('Pending', 'Reserved', 'Completed', 'Failed', 'Rejected', 'Released', 'Reversed')`,
    ),
    amountNonzero: check('chk_wallet_transactions_amount_nonzero', sql`${table.amount} <> 0`),
    walletIdIdx: index('idx_wallet_tx_wallet_id').on(table.walletId),
    stateIdx: index('idx_wallet_tx_state').on(table.state),
    typeIdx: index('idx_wallet_tx_type').on(table.type),
    /** Enforce idempotency: duplicate key detection. */
    idempotencyUniqueIdx: uniqueIndex('idx_wallet_tx_idempotency').on(table.idempotencyKey),
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
 * SQL to create the wallet_transactions table (migration 0068 source).
 *
 * Wallets itself is T-04.2.01.01; 0068 creates it IF NOT EXISTS so the
 * ledger FK has a target on databases that never received a wallets
 * migration. The available-balance trigger stays in `createWalletsTable`
 * (T-04.2.01.07) and is not applied here.
 */
export const createWalletTransactionsTable = sql`
  CREATE TABLE IF NOT EXISTS wallets (
    profile_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE RESTRICT,
    posted_balance BIGINT NOT NULL DEFAULT 0,
    reserved_balance BIGINT NOT NULL DEFAULT 0,
    version INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS wallet_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
    wallet_id UUID NOT NULL REFERENCES wallets(profile_id) ON DELETE RESTRICT,
    type TEXT NOT NULL
      CONSTRAINT chk_wallet_transactions_type
        CHECK (type IN ('topup', 'payment', 'refund', 'reservation', 'release', 'reversal', 'compensating')),
    amount BIGINT NOT NULL
      CONSTRAINT chk_wallet_transactions_amount_nonzero
        CHECK (amount <> 0),
    state TEXT NOT NULL DEFAULT 'Pending'
      CONSTRAINT chk_wallet_transactions_state
        CHECK (state IN ('Pending', 'Reserved', 'Completed', 'Failed', 'Rejected', 'Released', 'Reversed')),
    idempotency_key TEXT NOT NULL,
    ref_id TEXT,
    description TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_wallet_tx_wallet_id ON wallet_transactions (wallet_id);
  CREATE INDEX IF NOT EXISTS idx_wallet_tx_state ON wallet_transactions (state);
  CREATE INDEX IF NOT EXISTS idx_wallet_tx_type ON wallet_transactions (type);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_wallet_tx_idempotency ON wallet_transactions (idempotency_key);

  CREATE OR REPLACE FUNCTION update_wallet_transactions_updated_at()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $$
  BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
  END;
  $$;

  DROP TRIGGER IF EXISTS trg_wallet_transactions_updated_at ON wallet_transactions;

  CREATE TRIGGER trg_wallet_transactions_updated_at
    BEFORE UPDATE ON wallet_transactions
    FOR EACH ROW
    EXECUTE FUNCTION update_wallet_transactions_updated_at();
`
