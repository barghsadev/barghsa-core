import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { uuidv7, timestamptz } from '../types.js';

/** Durable transitions from the email and SMS provider circuit breakers. */
export const providerHealthEvents = pgTable(
  'provider_health_events',
  {
    id: uuidv7('id').primaryKey().notNull(),
    channel: text('channel', { enum: ['email', 'sms'] }).notNull(),
    providerId: uuid('provider_id').notNull(),
    kind: text('kind', {
      enum: ['circuit_open', 'circuit_recovered', 'low_credit', 'credit_recovered'],
    }).notNull(),
    createdAt: timestamptz('created_at').defaultNow().notNull(),
  },
  (table) => [
    check('chk_phe_channel', sql`${table.channel} IN ('email','sms')`),
    check(
      'chk_phe_kind',
      sql`${table.kind} IN ('circuit_open','circuit_recovered','low_credit','credit_recovered')`
    ),
    index('idx_phe_provider_created').on(table.channel, table.providerId, table.createdAt),
  ]
);
