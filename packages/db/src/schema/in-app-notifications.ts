import { jsonb, pgTable, text, boolean, index } from 'drizzle-orm/pg-core'
import { uuidv7, timestamptz } from '../types.js'
import { profiles } from './profiles.js'

/**
 * In-app notification center storage (E-05, T-05.02.01).
 *
 * One row per notification shown in a user's in-app notification center. The
 * in-app transport adapter writes a row here synchronously when the outbox
 * worker dispatches an `in_app` channel, so an in-app notification is durable
 * the moment its business event fires.
 *
 * Semantics:
 * - `type` — the notification/event type (e.g. 'profile_verified'). The UI
 *   maps it to an icon, and the notification-center API (T-05.02.02) filters
 *   and groups on it.
 * - `titleI18nKey` / `bodyI18nKey` — persisted i18n keys, not rendered text.
 *   The locale dictionaries (fa/en) hold the concrete strings; the UI renders
 *   them and interpolates `params`. Concrete template rendering lands with the
 *   template engine (T-05.04.02); until then the transport derives keys from
 *   the event type (`notifications.<type>.title` / `.body`).
 * - `params` — JSONB of interpolation variables used to render placeholders.
 * - `linkRoute` / `linkParams` — deep-link the UI follows when the
 *   notification is clicked (e.g. '/app/orders/:id' plus resolved params).
 * - `isRead` / `readAt` — flipped by the notification-center API
 *   (T-05.02.02). Read state is the row's only mutable data.
 *
 * Notes:
 * - `updated_at` from the shared base columns is deliberately omitted: the
 *   row is append-only apart from read state, so `created_at` is the only
 *   lifecycle timestamp of record. Defined with `pgTable` directly (not
 *   `createTable`) for exactly this reason.
 * - Indexed on `(profile_id, created_at DESC)` to serve the center's
 *   newest-first, cursor-paginated list query.
 */
export const inAppNotifications = pgTable(
  'in_app_notifications',
  {
    /** UUIDv7 primary key. */
    id: uuidv7('id').primaryKey().notNull(),

    /** FK to the recipient profile (owner of the notification center). */
    profileId: uuidv7('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),

    /** Notification/event type — drives iconography & routing. */
    type: text('type').notNull(),

    /** i18n key for the rendered title. */
    titleI18nKey: text('title_i18n_key').notNull(),

    /** i18n key for the rendered body. */
    bodyI18nKey: text('body_i18n_key').notNull(),

    /** JSON interpolation variables used to render title/body placeholders. */
    params: jsonb('params').notNull().default({}),

    /** Deep-link route to open when the notification is clicked. */
    linkRoute: text('link_route'),

    /** Parameters merged into the link route. */
    linkParams: jsonb('link_params'),

    /** Whether the recipient has read this notification. */
    isRead: boolean('is_read').notNull().default(false),

    /** When the recipient read it (NULL until read). */
    readAt: timestamptz('read_at'),

    /** When the notification was created. */
    createdAt: timestamptz('created_at').defaultNow().notNull(),
  },
  (table) => [
    // Notification-center list query: a profile's notifications newest-first.
    index('idx_ian_profile_created').on(table.profileId, table.createdAt),
  ],
)
