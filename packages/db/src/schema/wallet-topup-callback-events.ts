import { index, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { uuidv7, timestamptz } from '../types.js'
import { walletTransactions, wallets } from './wallets.js'

/**
 * Durable ledger of authenticated online top-up provider callbacks
 * (T-04.2.02.02 / S-04.2.02).
 *
 * Each distinct provider `event_id` is claimed at most once (atomic
 * INSERT … ON CONFLICT DO NOTHING RETURNING) before any wallet side
 * effect. `processing` is the in-flight claim so a crash can resume
 * the same pending order; terminal values are `credited`, `unpaid`,
 * and `duplicate`. `raw` keeps the verified JSON snapshot for audit
 * and must never include the HMAC secret.
 */
export const walletTopupCallbackEvents = pgTable(
  'wallet_topup_callback_events',
  {
    /** UUIDv7 primary key. */
    id: uuidv7('id').primaryKey().notNull(),

    /** Provider event id — stable across retries; unique idempotency gate. */
    eventId: text('event_id').notNull(),

    /** Pending (or later Released) top-up ledger row this event refers to. */
    pendingTransactionId: uuid('pending_transaction_id')
      .notNull()
      .references(() => walletTransactions.id, { onDelete: 'restrict' }),

    /** Wallet / profile the credit was applied to. */
    walletId: uuid('wallet_id')
      .notNull()
      .references(() => wallets.profileId, { onDelete: 'restrict' }),

    /** Claim/outcome: processing, credited, unpaid, or ignored duplicate. */
    status: text('status', {
      enum: ['processing', 'credited', 'unpaid', 'duplicate'],
    }).notNull(),

    /** Verified callback JSON (no secrets). */
    raw: jsonb('raw'),

    createdAt: timestamptz('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_wallet_topup_callback_event_id').on(table.eventId),
    index('idx_wtce_pending_tx').on(table.pendingTransactionId),
    index('idx_wtce_wallet').on(table.walletId),
  ],
)
