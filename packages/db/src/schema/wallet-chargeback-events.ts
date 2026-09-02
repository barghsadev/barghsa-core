import { index, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { uuidv7, timestamptz } from '../types.js'
import { walletTransactions, wallets } from './wallets.js'

/**
 * Durable ledger of authenticated provider chargeback notifications
 * (T-04.2.04.02 / S-04.2.04).
 *
 * Each distinct provider `event_id` is claimed at most once (atomic
 * INSERT … ON CONFLICT DO NOTHING RETURNING) before mapping or
 * reversing. `processing` is the in-flight claim so a crash can resume
 * the same event. Terminal values:
 *   - `reversed`   — original Completed top-up was mapped and reversed
 *   - `unmatched`  — signature-valid notification could not be traced
 *   - `unresolved` — original mapped but reversal could not post
 *   - `duplicate`  — same event_id already reached a terminal status
 *
 * `original_transaction_id` / `wallet_id` stay NULL for unmatched
 * events so we never invent a ledger debit against an unknown wallet.
 * `raw` keeps the verified JSON snapshot and must never include the
 * HMAC secret.
 */
export const walletChargebackEvents = pgTable(
  'wallet_chargeback_events',
  {
    /** UUIDv7 primary key. */
    id: uuidv7('id').primaryKey().notNull(),

    /** Provider event id — stable across retries; unique idempotency gate. */
    eventId: text('event_id').notNull(),

    /** Completed top-up credit this chargeback maps to, when unique. */
    originalTransactionId: uuid('original_transaction_id').references(
      () => walletTransactions.id,
      { onDelete: 'restrict' },
    ),

    /** Compensating reversal row, when reverseTransaction posted. */
    reversalTransactionId: uuid('reversal_transaction_id').references(
      () => walletTransactions.id,
      { onDelete: 'restrict' },
    ),

    /** Wallet of the mapped original; NULL when unmatched. */
    walletId: uuid('wallet_id').references(() => wallets.profileId, {
      onDelete: 'restrict',
    }),

    /** Claim/outcome. */
    status: text('status', {
      enum: ['processing', 'reversed', 'unmatched', 'unresolved', 'duplicate'],
    }).notNull(),

    /** How the original was identified; NULL when unmatched. */
    matchMethod: text('match_method', {
      enum: ['merchant_order_id', 'provider_ref_id', 'authority'],
    }),

    /** Verified chargeback JSON (no secrets). */
    raw: jsonb('raw'),

    createdAt: timestamptz('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_wallet_chargeback_event_id').on(table.eventId),
    index('idx_wce_original_tx').on(table.originalTransactionId),
    index('idx_wce_wallet').on(table.walletId),
    index('idx_wce_status').on(table.status),
  ],
)
