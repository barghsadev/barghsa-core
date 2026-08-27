import { boolean, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { uuidv7, timestamptz, pgEnum } from '../types.js'
import { profiles } from './profiles.js'

/**
 * Notification category discriminator (T-05.05.01).
 *
 * Separates transactional from marketing notifications so the delivery layer
 * can enforce consent correctly:
 *
 * - `mandatory_transactional` — transactional, security/payment/contract
 *   notifications that are always sent (external channel follows verified
 *   destinations). Never requires marketing consent.
 * - `marketing` — promotional notifications that require explicit opt-in
 *   consent (`userNotificationPreferences.marketing_opted_in`). If no opt-in,
 *   external delivery is skipped entirely.
 *
 * This mirrors the `category` field on `NotificationTypeDefinition` in
 * `@barghsa/shared` (NOTIFICATION_TYPE_REGISTRY), which classifies each event
 * key as `mandatory | marketing | system` at code level. The registry is the
 * routing source of truth; this DB lookup table is the admin-referenceable
 * category catalog.
 */
export const notificationCategoryEnum = pgEnum('notification_category', [
  'mandatory_transactional',
  'marketing',
])

/**
 * Notification categories lookup table.
 *
 * A small, seeded reference table cataloguing the consent classes. Seeded with
 * exactly two rows (`mandatory_transactional`, `marketing`). `is_marketing`
 * flags whether a category is consent-gated so downstream logic does not need
 * to hard-code the mapping.
 */
export const notificationCategories = pgTable(
  'notification_categories',
  {
    /** UUIDv7 primary key. */
    id: uuidv7('id').primaryKey().notNull(),

    /** Notification category enum value — unique. */
    category: notificationCategoryEnum('category').notNull(),

    /** Whether this category requires marketing opt-in consent. */
    isMarketing: boolean('is_marketing').notNull().default(false),

    /** Human-readable description of the category. */
    description: text('description'),

    /** Record creation timestamp. */
    createdAt: timestamptz('created_at').defaultNow().notNull(),

    /** Record last-updated timestamp. */
    updatedAt: timestamptz('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('uq_notification_categories_category').on(table.category),
  ],
)

/**
 * Per-profile notification preferences (T-05.05.01).
 *
 * One row per (profile, channel) controlling marketing opt-in. Default is
 * marketing OFF (`marketing_opted_in = false`), so a profile never receives
 * marketing notifications unless it has explicitly opted in.
 *
 * Consent lifecycle:
 * - `consent_granted_at` — when the user last opted in (marketing_opted_in
 *   transitioned to true).
 * - `consent_revoked_at` — when the user last opted out (marketing_opted_in
 *   transitioned to false).
 *
 * A partial-unique-index equivalent is enforced via a full unique index on
 * `(profile_id, channel)` — at most one preference row per profile+channel.
 *
 * The task also references `category` routing (mandatory vs marketing) which
 * is enforced downstream by the channel-availability rules (T-05.05.02); this
 * table stores the consent decision those rules consult.
 */
export const userNotificationPreferences = pgTable(
  'user_notification_preferences',
  {
    /** UUIDv7 primary key. */
    id: uuidv7('id').primaryKey().notNull(),

    /** FK to the owning profile. Deleting a profile removes its preferences. */
    profileId: uuidv7('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),

    /** Delivery channel: 'email', 'sms', or 'in_app'. */
    channel: text('channel', { enum: ['email', 'sms', 'in_app'] }).notNull(),

    /** Whether the user has opted in to marketing on this channel. Default false. */
    marketingOptedIn: boolean('marketing_opted_in').notNull().default(false),

    /** When the user last granted marketing consent. NULL until first opt-in. */
    consentGrantedAt: timestamptz('consent_granted_at'),

    /** When the user last revoked marketing consent. NULL until first opt-out. */
    consentRevokedAt: timestamptz('consent_revoked_at'),

    /** Record creation timestamp. */
    createdAt: timestamptz('created_at').defaultNow().notNull(),

    /** Record last-updated timestamp. */
    updatedAt: timestamptz('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('uq_user_notification_preferences_profile_channel').on(
      table.profileId,
      table.channel,
    ),
  ],
)

/**
 * SQL to pre-seed the notification_categories lookup table.
 *
 * Runs in migration 0030. `ON CONFLICT (category) DO NOTHING` keeps the seed
 * idempotent so re-running never duplicates rows.
 */
export const seedNotificationCategoriesSql = sql`
  INSERT INTO notification_categories (category, is_marketing, description) VALUES
    ('mandatory_transactional', false, 'Transactional/security notifications always delivered; never consent-gated.'),
    ('marketing', true, 'Promotional notifications gated behind explicit opt-in consent.')
  ON CONFLICT (category) DO NOTHING;
`
