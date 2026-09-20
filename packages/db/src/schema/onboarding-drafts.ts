import { sql } from 'drizzle-orm';
import { pgTable, uuid, integer, jsonb, timestamp, check } from 'drizzle-orm/pg-core';
import { profiles } from './profiles';

export const profileOnboardingDrafts = pgTable(
  'profile_onboarding_drafts',
  {
    profileId: uuid('profile_id')
      .primaryKey()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    data: jsonb('data').$type<Record<string, string>>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('onboarding_draft_version', sql`${table.version} > 0`),
    check(
      'onboarding_draft_object',
      sql`jsonb_typeof(${table.data})='object' AND octet_length(${table.data}::text)<=16384`
    ),
  ]
);
