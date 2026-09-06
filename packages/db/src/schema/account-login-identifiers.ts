import { sql } from 'drizzle-orm';
import { pgTable, text, timestamp, check, unique } from 'drizzle-orm/pg-core';
import { users } from './users';

/** Primary username reservations and OTP-proven secondary login identifiers. */
export const accountLoginIdentifiers = pgTable(
  'account_login_identifiers',
  {
    destination: text('destination').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.userId, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['primary', 'email', 'mobile'] }).notNull(),
    verifiedAt: timestamp('verified_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    // Maintained by the identifier validation trigger.
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    unique('account_login_identifiers_user_kind_key').on(table.userId, table.kind),
    check(
      'account_login_identifiers_kind_check',
      sql`${table.kind} IN ('primary','email','mobile')`
    ),
    check(
      'account_login_identifiers_destination_check',
      sql`${table.destination}=lower(${table.destination}) AND length(${table.destination})>0`
    ),
    check(
      'account_login_identifiers_proof_check',
      sql`(${table.kind}='primary' AND ${table.verifiedAt} IS NULL) OR (${table.kind}<>'primary' AND ${table.verifiedAt} IS NOT NULL)`
    ),
  ]
);
export type AccountLoginIdentifier = typeof accountLoginIdentifiers.$inferSelect;
