import { index, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

/** Security observations are independent of the business transaction that was denied. */
export const authorizationDenials = pgTable(
  'authorization_denials',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    actorId: varchar('actor_id', { length: 128 }).notNull(),
    resource: varchar('resource', { length: 256 }).notNull(),
    action: varchar('action', { length: 32 }).notNull(),
    reason: varchar('reason', { length: 96 }).notNull(),
    correlationId: uuid('correlation_id'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
  },
  (t) => [index('authorization_denials_timeline_idx').on(t.createdAt, t.id)]
);
