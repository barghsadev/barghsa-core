import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/** Anonymous, closed-dimension product analytics; operational audits stay in audit_log. */
export const analyticsEvents = pgTable(
  'analytics_events',
  {
    id: uuid('id').primaryKey(),
    eventName: text('event_name').notNull(),
    area: text('area'),
    service: text('service'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    check(
      'analytics_events_shape_check',
      sql`(${table.eventName} = 'page_view' AND ${table.area} IN ('customer', 'admin') AND ${table.service} IS NULL)
          OR (${table.eventName} IN ('catalogue_view', 'order_flow_start') AND ${table.area} IS NULL AND ${table.service} IN ('electricity', 'saving', 'solar'))`
    ),
    index('analytics_events_name_created_idx').on(table.eventName, table.createdAt),
  ]
);

export type AnalyticsEventRow = typeof analyticsEvents.$inferSelect;
