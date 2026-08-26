import { text, boolean, timestamp, pgEnum } from 'drizzle-orm/pg-core'
import { createTable } from '../base-table.js'
import { users } from './users.js'
import { profiles } from './profiles.js'

/**
 * Notification type enum.
 * Describes the category of notification for routing and display logic.
 */
export const notificationType = pgEnum('notification_type', [
  'verification_status',
  'profile_verified',
  'profile_unverified',
  'profile_pending',
  'general',
])

/**
 * In-app notifications table (minimal stub for E-02 scope).
 *
 * Stores notifications that appear in the user's notification center.
 * This is a lightweight in-app-only store — the full notification
 * infrastructure (email/SMS transport, outbox, worker) belongs to E-05.
 *
 * Each notification targets a single user and optionally a profile
 * context so the UI can link back to the relevant profile.
 */
export const notifications = createTable('notifications', {
  /** FK to the recipient user. */
  userId: text('user_id')
    .notNull()
    .references(() => users.userId, { onDelete: 'cascade' }),

  /** Optional FK to the related profile, for context. */
  profileId: text('profile_id')
    .references(() => profiles.id, { onDelete: 'set null' }),

  /** Notification type for categorisation and display. */
  type: notificationType('type').notNull().default('general'),

  /** Short, localised title (e.g. "Profile verified"). */
  title: text('title').notNull(),

  /** Optional body text with details. */
  body: text('body'),

  /** Optional deep-link relative URL (e.g. "/app/profiles/..."). */
  link: text('link'),

  /** Whether the recipient has read this notification. */
  read: boolean('read').notNull().default(false),

  /** When the notification was read, if ever. */
  readAt: timestamp('read_at', { withTimezone: true, mode: 'date' }),
})
