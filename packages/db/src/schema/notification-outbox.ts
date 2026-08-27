import { jsonb, pgTable, text, integer, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'
import { uuidv7, timestamptz } from '../types.js'
import { profiles } from './profiles.js'
import { users } from './users.js'

/**
 * Notification outbox (E-05, T-05.01.01 / T-05.01.02).
 *
 * A durable, transactional outbox. Business events write a row here in the
 * SAME database transaction as the business state change, guaranteeing the
 * delivery intent is never lost even if the process crashes afterwards. A
 * background worker then leases unlocked rows and dispatches them through the
 * appropriate transport.
 *
 * Lifecycle columns:
 * - `status` — queued → scheduled | sending → delivered | failed | cancelled.
 * - `locked_until` — lease marker: a worker claims a row by setting a future
 *   `locked_until`; rows whose lease has expired are claimable again (crash
 *   recovery). NULL means the row is free.
 * - `attempts` / `max_attempts` — bounded retry with backoff (T-05.01.03).
 * - `idempotency_key` — unique per (event, channel, recipient) so retries and
 *   re-inserted duplicate rows never double-deliver (T-05.01.04).
 * - `scheduled_for` — when the row becomes eligible (delivery-window logic,
 *   T-05.03.02).
 */
export const notificationOutbox = pgTable(
  'notification_outbox',
  {
    id: uuidv7('id').primaryKey().notNull(),

    /** FK to the recipient profile (owner of the notification). */
    profileId: uuidv7('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),

    /** FK to the recipient user when the target is a user (in-app delivery). */
    userId: text('user_id').references(() => users.userId, { onDelete: 'cascade' }),

    /** Business event key, e.g. 'profile_verified'. Used for template lookup. */
    eventKey: text('event_key').notNull(),

    /** JSON payload of variables used to render the message. */
    payload: jsonb('payload').notNull().default({}),

    /** Target channels, e.g. ['in_app', 'email']. */
    channels: text('channels').array().notNull(),

    /** Delivery lifecycle status. */
    status: text('status', {
      enum: [
        'queued',
        'scheduled',
        'sending',
        'delivered',
        'failed',
        'cancelled',
      ],
    })
      .notNull()
      .default('queued'),

    /**
     * Row-level idempotency key — sha256(eventKey + profileId). Uniquely
     * deduplicates whole outbox rows for the same (event, profile); duplicate
     * inserts are skipped with ON CONFLICT DO NOTHING. Per-channel provider
     * idempotency (sha256(eventKey:channel:profileId)) is derived by the worker
     * at dispatch time (T-05.01.04).
     */
    idempotencyKey: text('idempotency_key').notNull(),

    /** Leased window. NULL when unlocked; future timestamp = claimed by a worker. */
    lockedUntil: timestamptz('locked_until'),

    /** Number of delivery attempts so far. */
    attempts: integer('attempts').notNull().default(0),

    /** Maximum attempts before the row moves to dead-letter (T-05.01.06). */
    maxAttempts: integer('max_attempts').notNull().default(5),

    /** Safe error message from the last failed attempt (never logs secrets). */
    lastError: text('last_error'),

    /** Provider reference from the last send attempt. */
    providerRef: text('provider_ref'),

    /** Earliest time the row is eligible for dispatch (delivery window). */
    scheduledFor: timestamptz('scheduled_for'),

    createdAt: timestamptz('created_at').defaultNow().notNull(),
    updatedAt: timestamptz('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('uq_notification_outbox_idempotency').on(table.idempotencyKey),
  ],
)

/**
 * Job queue table (T-05.01.03) — one row per channel disposition of an outbox
 * row. Allows per-channel retry scheduling, priority (urgent vs daytime), and
 * a bounded retry schedule (1min → 5min → 30min → 2hr → final) with backoff.
 */
export const notificationJob = pgTable(
  'notification_job',
  {
    id: uuidv7('id').primaryKey().notNull(),

    /** The outbox row this job dispatches. */
    outboxId: uuidv7('outbox_id')
      .notNull()
      .references(() => notificationOutbox.id, { onDelete: 'cascade' }),

    /** The channel this job targets (one job per outbox row per channel). */
    channel: text('channel', { enum: ['in_app', 'email', 'sms'] }).notNull(),

    /** Job status: queued → running | retrying → done | failed | dead_letter. */
    status: text('status', {
      enum: ['queued', 'running', 'retrying', 'done', 'failed', 'dead_letter'],
    })
      .notNull()
      .default('queued'),

    /** Queue priority: 'urgent' dispatches before 'normal'. */
    priority: text('priority', { enum: ['urgent', 'normal'] }).notNull().default('normal'),

    /** Number of attempts so far for this job (channel). */
    attempts: integer('attempts').notNull().default(0),

    /** Maximum attempts before dead-letter. */
    maxAttempts: integer('max_attempts').notNull().default(5),

    /** Earliest time this job may run (backoff / delivery window). */
    runAfter: timestamptz('run_after'),

    /** Safe error message from the last attempt. */
    lastError: text('last_error'),

    createdAt: timestamptz('created_at').defaultNow().notNull(),
    updatedAt: timestamptz('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [uniqueIndex('uq_notification_job_outbox_channel').on(table.outboxId, table.channel)],
)