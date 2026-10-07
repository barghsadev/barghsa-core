import { sql } from 'drizzle-orm';
import { boolean, check, index, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { timestamptz, uuidv7 } from '../types.js';
import { profiles } from './profiles.js';
import { users } from './users.js';

/** Independent rows avoid a shared queue-row lock in financial transactions. */
export const walletAlertSignals = pgTable(
  'wallet_alert_signals',
  {
    id: uuidv7('id').primaryKey().notNull(),
    profileId: uuid('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    source: text('source').notNull(),
    createdAt: timestamptz('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('wallet_alert_signals_profile_created_idx').on(table.profileId, table.createdAt),
    check(
      'wallet_alert_signals_source_check',
      sql`${table.source} IN ('wallet','invoice','profile')`
    ),
  ]
);

/** Only the evaluator writes episode state, after taking the profile lock. */
export const walletLowBalanceStates = pgTable('wallet_low_balance_states', {
  profileId: uuid('profile_id')
    .primaryKey()
    .references(() => profiles.id, { onDelete: 'cascade' }),
  active: boolean('active').default(false).notNull(),
  episodeId: uuidv7('episode_id').notNull(),
  recipientUserId: text('recipient_user_id').references(() => users.userId, {
    onDelete: 'set null',
  }),
  createdAt: timestamptz('created_at').defaultNow().notNull(),
  updatedAt: timestamptz('updated_at')
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

export type WalletAlertSignal = typeof walletAlertSignals.$inferSelect;
export type WalletLowBalanceState = typeof walletLowBalanceStates.$inferSelect;
