import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { baseColumns } from '../base-table';
import { timestamptz } from '../types';
import { users } from './users';
import { profiles } from './profiles';

/** Hashed deep-link proof; the original live session must confirm the private chat. */
export const telegramLinkIntents = pgTable(
  'telegram_link_intents',
  {
    ...baseColumns,
    userId: text('user_id')
      .notNull()
      .references(() => users.userId, { onDelete: 'restrict' }),
    profileId: uuid('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'restrict' }),
    // Retained proof does not prevent expired/revoked sessions from being cleaned up.
    sessionId: text('session_id').notNull(),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamptz('expires_at').notNull(),
    status: text('status').notNull().default('pending'),
    telegramUserId: bigint('telegram_user_id', { mode: 'bigint' }),
    chatId: bigint('chat_id', { mode: 'bigint' }),
    claimedAt: timestamptz('claimed_at'),
    confirmedAt: timestamptz('confirmed_at'),
    confirmationAttempts: integer('confirmation_attempts').notNull().default(0),
  },
  (t) => [
    uniqueIndex('telegram_intent_token_unique').on(t.tokenHash),
    index('telegram_intent_owner_idx').on(t.userId, t.createdAt),
    check('telegram_intent_hash', sql`${t.tokenHash} ~ '^[a-f0-9]{64}$'`),
    check(
      'telegram_intent_status',
      sql`${t.status} IN ('pending','claimed','confirmed','cancelled')`
    ),
    check(
      'telegram_intent_expiry',
      sql`${t.expiresAt}>${t.createdAt} AND ${t.expiresAt}<=${t.createdAt}+INTERVAL '10 minutes'`
    ),
    check('telegram_intent_attempts', sql`${t.confirmationAttempts} BETWEEN 0 AND 5`),
    check(
      'telegram_intent_private',
      sql`(${t.telegramUserId} IS NULL AND ${t.chatId} IS NULL AND ${t.claimedAt} IS NULL) OR (${t.telegramUserId} IS NOT NULL AND ${t.chatId} IS NOT NULL AND ${t.telegramUserId} BETWEEN 1 AND 4503599627370495 AND ${t.chatId}=${t.telegramUserId} AND ${t.claimedAt} IS NOT NULL)`
    ),
    check(
      'telegram_intent_state_proof',
      sql`(${t.status}='pending' AND ${t.telegramUserId} IS NULL AND ${t.confirmedAt} IS NULL) OR (${t.status}='claimed' AND ${t.telegramUserId} IS NOT NULL AND ${t.confirmedAt} IS NULL) OR (${t.status}='confirmed' AND ${t.telegramUserId} IS NOT NULL AND ${t.confirmedAt} IS NOT NULL) OR (${t.status}='cancelled' AND ${t.confirmedAt} IS NULL)`
    ),
  ]
);

/** Revocation preserves the prior binding and its confirmation evidence. */
export const telegramLinks = pgTable(
  'telegram_links',
  {
    ...baseColumns,
    userId: text('user_id')
      .notNull()
      .references(() => users.userId, { onDelete: 'restrict' }),
    profileId: uuid('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'restrict' }),
    intentId: uuid('intent_id')
      .notNull()
      .references(() => telegramLinkIntents.id, { onDelete: 'restrict' }),
    telegramUserId: bigint('telegram_user_id', { mode: 'bigint' }).notNull(),
    chatId: bigint('chat_id', { mode: 'bigint' }).notNull(),
    verifiedAt: timestamptz('verified_at').notNull(),
    revokedAt: timestamptz('revoked_at'),
  },
  (t) => [
    uniqueIndex('telegram_link_intent_unique').on(t.intentId),
    uniqueIndex('telegram_link_active_user_unique')
      .on(t.userId)
      .where(sql`${t.revokedAt} IS NULL`),
    uniqueIndex('telegram_link_active_chat_unique')
      .on(t.telegramUserId)
      .where(sql`${t.revokedAt} IS NULL`),
    index('telegram_link_profile_idx').on(t.profileId),
    check(
      'telegram_link_private',
      sql`${t.telegramUserId} BETWEEN 1 AND 4503599627370495 AND ${t.chatId}=${t.telegramUserId}`
    ),
    check(
      'telegram_link_revocation',
      sql`${t.revokedAt} IS NULL OR ${t.revokedAt}>=${t.verifiedAt}`
    ),
  ]
);

/** Dedicated update/reply ledger; unknown delivery is terminal until explicit recovery. */
export const telegramUpdates = pgTable(
  'telegram_updates',
  {
    ...baseColumns,
    updateId: bigint('update_id', { mode: 'bigint' }).notNull(),
    messageId: bigint('message_id', { mode: 'bigint' }).notNull(),
    telegramUserId: bigint('telegram_user_id', { mode: 'bigint' }).notNull(),
    chatId: bigint('chat_id', { mode: 'bigint' }).notNull(),
    kind: text('kind').notNull(),
    intentId: uuid('intent_id').references(() => telegramLinkIntents.id, { onDelete: 'restrict' }),
    linkId: uuid('link_id').references(() => telegramLinks.id, { onDelete: 'restrict' }),
    requestHash: text('request_hash').notNull(),
    message: text('message'),
    answer: jsonb('answer'),
    status: text('status').notNull().default('queued'),
    leaseToken: uuid('lease_token'),
    leaseUntil: timestamptz('lease_until'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamptz('next_attempt_at').notNull().defaultNow(),
    sentMessageId: bigint('sent_message_id', { mode: 'bigint' }),
    lastError: text('last_error'),
  },
  (t) => [
    uniqueIndex('telegram_update_id_unique').on(t.updateId),
    index('telegram_update_work_idx').on(t.status, t.nextAttemptAt, t.createdAt),
    index('telegram_update_link_idx').on(t.linkId, t.createdAt),
    check(
      'telegram_update_identity',
      sql`${t.updateId} BETWEEN 0 AND 9007199254740991 AND ${t.messageId}>0 AND ${t.telegramUserId} BETWEEN 1 AND 4503599627370495 AND ${t.chatId}=${t.telegramUserId}`
    ),
    check('telegram_update_hash', sql`${t.requestHash} ~ '^[a-f0-9]{64}$'`),
    check(
      'telegram_update_kind',
      sql`(${t.kind}='link_confirmation' AND ${t.intentId} IS NOT NULL AND ${t.linkId} IS NULL AND ${t.message} IS NULL) OR (${t.kind}='question' AND ${t.linkId} IS NOT NULL AND ${t.intentId} IS NULL AND ${t.message} IS NOT NULL AND char_length(${t.message}) BETWEEN 1 AND 1000)`
    ),
    check(
      'telegram_update_status',
      sql`${t.status} IN ('queued','processing','ready','sending','sent','denied','failed','unknown')`
    ),
    check('telegram_update_attempts', sql`${t.attempts} BETWEEN 0 AND 3`),
    check(
      'telegram_update_lease',
      sql`(${t.status} IN ('processing','sending') AND ${t.leaseToken} IS NOT NULL AND ${t.leaseUntil} IS NOT NULL) OR (${t.status} NOT IN ('processing','sending') AND ${t.leaseToken} IS NULL AND ${t.leaseUntil} IS NULL)`
    ),
    check(
      'telegram_update_receipt',
      sql`(${t.status}='sent' AND ${t.sentMessageId} IS NOT NULL AND ${t.sentMessageId}>0) OR (${t.status}<>'sent' AND ${t.sentMessageId} IS NULL)`
    ),
    check(
      'telegram_update_answer',
      sql`${t.answer} IS NULL OR (jsonb_typeof(${t.answer})='object' AND octet_length(${t.answer}::text)<=32768)`
    ),
  ]
);
