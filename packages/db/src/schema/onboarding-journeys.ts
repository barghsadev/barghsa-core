import { sql } from 'drizzle-orm';
import { pgTable, uuid, text, timestamp, uniqueIndex, check } from 'drizzle-orm/pg-core';
import { users } from './users';
import { profiles } from './profiles';

/** One durable selection of personal/company profiles, including an unfinished setup. */
export const profileOnboardingJourneys = pgTable(
  'profile_onboarding_journeys',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuid_generate_v7()`),
    userId: text('user_id')
      .notNull()
      .references(() => users.userId, { onDelete: 'cascade' }),
    requestId: uuid('request_id').notNull(),
    individualProfileId: uuid('individual_profile_id')
      .references(() => profiles.id, { onDelete: 'cascade' })
      .unique(),
    legalProfileId: uuid('legal_profile_id')
      .references(() => profiles.id, { onDelete: 'cascade' })
      .unique(),
    selectedProfileId: uuid('selected_profile_id'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('onboarding_journey_request').on(table.userId, table.requestId),
    uniqueIndex('onboarding_journey_open')
      .on(table.userId)
      .where(sql`${table.completedAt} IS NULL`),
    check(
      'onboarding_journey_profiles',
      sql`${table.individualProfileId} IS NOT NULL OR ${table.legalProfileId} IS NOT NULL`
    ),
    check(
      'onboarding_journey_distinct_profiles',
      sql`${table.individualProfileId} IS DISTINCT FROM ${table.legalProfileId}`
    ),
    check(
      'onboarding_journey_completed',
      sql`(${table.completedAt} IS NULL AND ${table.selectedProfileId} IS NULL) OR
    (${table.completedAt} IS NOT NULL AND ${table.selectedProfileId} IS NOT NULL AND
    COALESCE(${table.selectedProfileId}=${table.individualProfileId} OR ${table.selectedProfileId}=${table.legalProfileId}, false))`
    ),
  ]
);
