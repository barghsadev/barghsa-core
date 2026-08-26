import { boolean, pgTable, text, jsonb } from 'drizzle-orm/pg-core'
import { uuidv7, timestamptz } from '../types.js'
import { users } from './users.js'

/**
 * Notification templates table (T-09.04.01).
 *
 * Stores editable notification templates for each event key,
 * channel, and locale combination. Admins can create, edit,
 * preview, and publish notification templates.
 *
 * - `event_key` — The event that triggers this notification, e.g.
 *   'profile_verified', 'welcome_email', 'invoice_available'.
 * - `channel` — Delivery channel: 'email', 'sms', 'in_app'.
 * - `locale` — Language: 'fa' (Persian) or 'en' (English).
 * - `subject` — Email subject line (used only for email channel).
 * - `body_template` — The template body with {{variable}} placeholders.
 * - `variables` — Allow-listed variable names as JSON array.
 * - `status` — 'draft' (editable, not used in delivery) or 'active'
 *   (used by the notification engine for real deliveries).
 * - `is_active` — Whether this template is the currently active one
 *   for the event+channel+locale combination.
 * - `published_at` — When this template was last published to active.
 * - `created_by` — FK to users (last editor).
 */
export const notificationTemplates = pgTable(
  'notification_templates',
  {
    /** UUIDv7 primary key. */
    id: uuidv7('id').primaryKey().notNull(),

    /** Event key that triggers this notification (e.g. 'profile_verified'). */
    eventKey: text('event_key').notNull(),

    /** Delivery channel: 'email', 'sms', or 'in_app'. */
    channel: text('channel', { enum: ['email', 'sms', 'in_app'] }).notNull(),

    /** Language locale: 'fa' or 'en'. */
    locale: text('locale', { enum: ['fa', 'en'] }).notNull(),

    /** Email subject line (only meaningful for email channel). */
    subject: text('subject'),

    /** Template body content with {{variable}} placeholders. */
    bodyTemplate: text('body_template').notNull(),

    /**
     * JSON array of allowed variable names that can be used in the
     * template, e.g. ["userName", "profileLink", "verificationCode"].
     */
    variables: jsonb('variables').notNull().default([]),

    /**
     * Lifecycle status: 'draft' (editable, not used in delivery)
     * or 'active' (used by the notification engine).
     */
    status: text('status', { enum: ['draft', 'active'] })
      .notNull()
      .default('draft'),

    /** Whether this template is currently active for its event+channel+locale. */
    isActive: boolean('is_active').notNull().default(false),

    /** When this template was last published to active. */
    publishedAt: timestamptz('published_at'),

    /** FK to users — the last editor of this template. */
    createdBy: text('created_by')
      .references(() => users.userId, { onDelete: 'set null' }),

    /** Record creation timestamp. */
    createdAt: timestamptz('created_at').defaultNow().notNull(),

    /** Record last-updated timestamp. */
    updatedAt: timestamptz('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  /**
   * Unique constraint: one template per event+channel+locale combination.
   * This ensures there is exactly one row (which toggles between draft/active
   * states) per unique notification definition.
   */
  (table) => ({
    eventChannelLocaleUnique: {
      name: 'uq_notification_templates_event_channel_locale',
      columns: [table.eventKey, table.channel, table.locale],
    },
  }),
)