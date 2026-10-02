import { sql } from 'drizzle-orm';
import { boolean, check, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { users } from './users';

/** Explicitly shared support identity; never inferred from private login identifiers. */
export const conversationIdentities = pgTable(
  'conversation_identities',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => users.userId, { onDelete: 'cascade' }),
    displayName: text('display_name'),
    /** Separate consent for business activity; existing support identities remain private there. */
    shareInActivity: boolean('share_in_activity').notNull().default(false),
    shareInPaymentActivity: boolean('share_in_payment_activity').notNull().default(false),
    avatarKey: text('avatar_key'),
    revision: integer('revision').notNull().default(1),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      'conversation_identity_name',
      sql`${table.displayName} IS NULL OR (char_length(${table.displayName}) BETWEEN 1 AND 80 AND ${table.displayName}=btrim(${table.displayName}) AND ${table.displayName} !~ '[[:cntrl:]]')`
    ),
    check(
      'conversation_identity_avatar',
      sql`${table.avatarKey} IS NULL OR ${table.avatarKey} ~ '^conversation-avatars/[a-f0-9-]{36}/[a-f0-9]{64}$'`
    ),
    check('conversation_identity_revision', sql`${table.revision} > 0`),
    check(
      'conversation_identity_activity_name',
      sql`NOT ${table.shareInActivity} OR ${table.displayName} IS NOT NULL`
    ),
    check(
      'conversation_identity_payment_name',
      sql`NOT ${table.shareInPaymentActivity} OR ${table.displayName} IS NOT NULL`
    ),
  ]
);
