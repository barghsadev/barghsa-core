import { check, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { baseColumns } from '../base-table';
import { products } from './products';
import { users } from './users';

export const savingPlanHardware = pgTable(
  'saving_plan_hardware',
  {
    ...baseColumns,
    planId: uuid('plan_id')
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),
    hardwareId: uuid('hardware_id')
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),
  },
  (table) => [uniqueIndex('saving_plan_hardware_pair_key').on(table.planId, table.hardwareId)]
);

export const savingPlanAgreementVersions = pgTable(
  'saving_plan_agreement_versions',
  {
    ...baseColumns,
    planId: uuid('plan_id')
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),
    title: text('title').notNull(),
    body: text('body').notNull(),
    status: text('status').notNull().default('draft'),
    effectiveFrom: timestamp('effective_from', { withTimezone: true }),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.userId, { onDelete: 'restrict' }),
  },
  (table) => [
    check('saving_plan_agreement_status', sql`${table.status} IN ('draft','active','superseded')`),
    check(
      'saving_plan_agreement_text',
      sql`length(trim(${table.title})) > 0 AND length(trim(${table.body})) > 0`
    ),
    check(
      'saving_plan_agreement_effective',
      sql`${table.status} = 'draft' OR ${table.effectiveFrom} IS NOT NULL`
    ),
    uniqueIndex('saving_plan_agreement_active_key')
      .on(table.planId)
      .where(sql`${table.status} = 'active'`),
    uniqueIndex('saving_plan_agreement_draft_key')
      .on(table.planId)
      .where(sql`${table.status} = 'draft'`),
  ]
);
