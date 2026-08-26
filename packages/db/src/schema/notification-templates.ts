import { boolean, pgTable, text, jsonb, integer, uniqueIndex } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { uuidv7, timestamptz } from '../types.js'
import { users } from './users.js'

/**
 * Notification templates table (T-09.04.01).
 *
 * Stores editable notification templates for each event key, channel, and
 * locale combination. Admins can create, edit, preview, and publish
 * notification templates.
 *
 * Versioning (mirrors brand_config): each publish increments `version` and the
 * previously-active template is demoted to `archived` (is_active=false) so
 * published history is retained. A partial unique index guarantees at most one
 * ACTIVE template per (event_key, channel, locale).
 *
 * - `event_key` — The event that triggers this notification, e.g.
 *   'profile_verified', 'welcome_email', 'invoice_available'.
 * - `channel` — Delivery channel: 'email', 'sms', 'in_app'.
 * - `locale` — Language: 'fa' (Persian) or 'en' (English).
 * - `subject` — Email subject line (used only for email channel).
 * - `body_template` — The template body with {{variable}} placeholders.
 * - `variables` — Allow-listed variable names as JSON array.
 * - `status` — 'draft' (editable, not used in delivery), 'active' (used by the
 *   notification engine), or 'archived' (a superseded published version kept
 *   for history).
 * - `version` — Monotonically increasing per publish for this combo.
 * - `is_active` — Whether this template is the currently active one for the
 *   event+channel+locale combination.
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
     * Lifecycle status: 'draft' (editable, not used in delivery),
     * 'active' (used by the notification engine), or 'archived'
     * (superseded published version retained for history).
     */
    status: text('status', { enum: ['draft', 'active', 'archived'] })
      .notNull()
      .default('draft'),

    /** Monotonically increasing per publish for this event+channel+locale. */
    version: integer('version').notNull().default(1),

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
  (table) => [
    /**
     * Partial unique index: at most ONE active template per
     * (event_key, channel, locale). Inactive draft/archived versions
     * are allowed, enabling version history.
     */
    uniqueIndex('uq_notification_templates_active')
      .on(table.eventKey, table.channel, table.locale)
      .where(sql`is_active = true`),
  ],
)
