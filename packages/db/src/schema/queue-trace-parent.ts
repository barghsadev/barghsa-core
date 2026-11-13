import { sql } from 'drizzle-orm';
import { check, type AnyPgColumn } from 'drizzle-orm/pg-core';

export function queueTraceParentCheck(table: string, column: AnyPgColumn) {
  return check(
    `${table}_trace_parent_valid`,
    sql`${column} ~ '^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$'
        AND substring(${column}, 4, 32) <> repeat('0', 32)
        AND substring(${column}, 37, 16) <> repeat('0', 16)`
  );
}
