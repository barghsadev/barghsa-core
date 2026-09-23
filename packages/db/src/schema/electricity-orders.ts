import { check, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { orders } from './orders';

/** Electricity-specific draft data. Confirmation will add the period and priced lines. */
export const electricityOrders = pgTable(
  'electricity_orders',
  {
    id: uuid('id')
      .primaryKey()
      .references(() => orders.id, { onDelete: 'restrict' }),
    mode: text('mode', { enum: ['simple', 'advanced'] })
      .notNull()
      .default('simple'),
    status: text('status', {
      enum: [
        'draft',
        'submitted',
        'awaiting_staff_review',
        'changes_requested',
        'approved',
        'active',
        'completed',
        'rejected',
        'cancelled',
      ],
    })
      .notNull()
      .default('draft'),
    settingsSnapshot: jsonb('settings_snapshot')
      .$type<{
        schemaVersion: 1;
        green: Record<string, unknown>;
        sourceVersion: number;
        contractLimits: Record<string, unknown>;
        contractLimitsVersion: number;
        capturedAt: string;
      }>()
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    index('electricity_orders_status_idx').on(table.status),
    check('electricity_orders_mode', sql`${table.mode} IN ('simple', 'advanced')`),
    check(
      'electricity_orders_status',
      sql`${table.status} IN ('draft', 'submitted', 'awaiting_staff_review', 'changes_requested', 'approved', 'active', 'completed', 'rejected', 'cancelled')`
    ),
    check(
      'electricity_orders_settings_snapshot_object',
      sql`jsonb_typeof(${table.settingsSnapshot}) = 'object'`
    ),
  ]
);

export type ElectricityOrder = typeof electricityOrders.$inferSelect;
export type NewElectricityOrder = typeof electricityOrders.$inferInsert;
