import { sql } from 'drizzle-orm';
import { pgTable, text, timestamp, check } from 'drizzle-orm/pg-core';

/** Immutable receipts from the protected operations receiver, separate from human audit actors. */
export const operationsAlertReceipts = pgTable(
  'operations_alert_receipts',
  {
    id: text('id').primaryKey(),
    alertName: text('alert_name').notNull(),
    fingerprint: text('fingerprint').notNull(),
    environment: text('environment').notNull(),
    database: text('database').notNull(),
    status: text('status', { enum: ['firing', 'resolved'] }).notNull(),
    severity: text('severity', { enum: ['warning', 'critical'] }).notNull(),
    priority: text('priority'),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('operations_alert_status_check', sql`${t.status} IN ('firing','resolved')`),
    check('operations_alert_severity_check', sql`${t.severity} IN ('warning','critical')`),
    check('operations_alert_priority_check', sql`${t.priority} IS NULL OR ${t.priority}='P2'`),
  ]
);
