import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  uuid,
} from 'drizzle-orm/pg-core';
import { timestamptz } from '../types.js';
import { notificationJob } from './notification-outbox.js';

/** Durable evidence around external sends, independent of outcome bookkeeping. */
export const notificationSendReceipts = pgTable(
  'notification_send_receipts',
  {
    outboxId: uuid('outbox_id').notNull(),
    channel: text('channel', { enum: ['email', 'sms'] }).notNull(),
    status: text('status', { enum: ['sending', 'accepted', 'rejected', 'unknown'] }).notNull(),
    providerId: uuid('provider_id'),
    transport: text('transport', { enum: ['smtp', 'resend', 'smsir'] }),
    idempotencyKey: text('idempotency_key').notNull(),
    attemptToken: uuid('attempt_token').notNull(),
    attemptNumber: integer('attempt_number').notNull().default(1),
    providerRef: text('provider_ref'),
    lastError: text('last_error'),
    acceptedAt: timestamptz('accepted_at'),
    smsReportDueAt: timestamptz('sms_report_due_at'),
    smsReportCheckedAt: timestamptz('sms_report_checked_at'),
    smsReportState: integer('sms_report_state'),
    smsReportDeliveredAt: timestamptz('sms_report_delivered_at'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.outboxId, table.channel] }),
    foreignKey({
      columns: [table.outboxId, table.channel],
      foreignColumns: [notificationJob.outboxId, notificationJob.channel],
    }).onDelete('cascade'),
    check('notification_send_attempt_check', sql`${table.attemptNumber} > 0`),
    check('notification_send_channel_check', sql`${table.channel} IN ('email','sms')`),
    check(
      'notification_send_status_check',
      sql`${table.status} IN ('sending','accepted','rejected','unknown')`
    ),
    check(
      'notification_send_identity_check',
      sql`length(btrim(${table.idempotencyKey})) BETWEEN 1 AND 1024`
    ),
    check(
      'notification_send_provider_check',
      sql`(${table.providerId} IS NOT NULL AND ${table.transport} IS NOT NULL AND ((${table.channel}='email' AND ${table.transport} IN ('smtp','resend')) OR (${table.channel}='sms' AND ${table.transport}='smsir'))) OR (${table.status}='unknown' AND ${table.providerId} IS NULL AND ${table.transport} IS NULL)`
    ),
    check(
      'notification_send_receipt_check',
      sql`(${table.status}='accepted' AND ${table.providerRef} IS NOT NULL AND length(btrim(${table.providerRef})) BETWEEN 1 AND 512 AND ${table.acceptedAt} IS NOT NULL) OR (${table.status}<>'accepted' AND ${table.providerRef} IS NULL AND ${table.acceptedAt} IS NULL)`
    ),
    check(
      'notification_send_sms_report_check',
      sql`(${table.smsReportDueAt} IS NULL AND ${table.smsReportCheckedAt} IS NULL AND ${table.smsReportState} IS NULL AND ${table.smsReportDeliveredAt} IS NULL)
        OR (${table.channel}='sms' AND ${table.status}='accepted' AND ${table.transport}='smsir'
          AND (${table.smsReportState} IS NULL OR (${table.smsReportState} BETWEEN 1 AND 7 AND ${table.smsReportCheckedAt} IS NOT NULL))
          AND (${table.smsReportDeliveredAt} IS NOT NULL) = COALESCE(${table.smsReportState}=1, false)
          AND (${table.smsReportState} IS NULL OR ${table.smsReportState} IN (3,5) OR ${table.smsReportDueAt} IS NULL))`
    ),
    index('notification_send_sms_report_due_idx')
      .on(table.smsReportDueAt, table.outboxId)
      .where(sql`${table.smsReportDueAt} IS NOT NULL AND ${table.channel}='sms'`),
  ]
);
