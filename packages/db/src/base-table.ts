import { domainChecks } from './domain-checks';
import { pgTable } from 'drizzle-orm/pg-core';
import type { PgColumnBuilderBase, PgTableWithColumns } from 'drizzle-orm/pg-core';
import type { BuildColumns } from 'drizzle-orm';
import { uuidv7, timestamptz } from './types';

/**
 * Base columns shared by every domain table.
 *
 * - `id` — UUIDv7 primary key, auto-generated via `uuid_generate_v7()`.
 * - `created_at` — set once on INSERT via `defaultNow()`.
 * - `updated_at` — set on INSERT via `defaultNow()` and updated
 *   automatically on every row modification.
 *
 * The `updated_at` column uses Drizzle's `$onUpdate` hook to automatically
 * stamp the current timestamp whenever the row is modified through the ORM.
 * A database-level `modify_updated_at()` trigger (in a future migration)
 * should complement this for direct-SQL writes outside the ORM.
 */
export const baseColumns = {
  id: uuidv7('id').primaryKey().notNull(),
  createdAt: timestamptz('created_at').defaultNow().notNull(),
  updatedAt: timestamptz('updated_at')
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
} as const;

/**
 * Create a domain table with the standard base columns pre-included.
 *
 * Usage:
 * ```ts
 * import { createTable } from '@barghsa/db/base-table'
 * import { text } from 'drizzle-orm/pg-core'
 *
 * export const users = createTable('users', {
 *   name: text('name').notNull(),
 * })
 * ```
 *
 * The resulting table has `id`, `created_at`, and `updated_at` columns
 * automatically — only domain-specific columns need to be passed.
 *
 * @param name  The PostgreSQL table name.
 * @param columns  Domain-specific column definitions (without base columns).
 * @returns A `PgTableWithColumns` instance ready for use with Drizzle ORM.
 */
export function createTable<
  TName extends string,
  TColumns extends Record<string, PgColumnBuilderBase>,
>(
  name: TName,
  columns: TColumns
): PgTableWithColumns<{
  name: TName;
  schema: undefined;
  columns: BuildColumns<TName, typeof baseColumns & TColumns, 'pg'>;
  dialect: 'pg';
}> {
  return pgTable(name, { ...baseColumns, ...columns }, () => domainChecks(name));
}
