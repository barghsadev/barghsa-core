import { describe, expect, it } from 'vitest';
import { is } from 'drizzle-orm';
import { PgTable, getTableConfig } from 'drizzle-orm/pg-core';
import * as schema from './index';

describe('declared foreign keys', () => {
  it('uses matching PostgreSQL types for every reference', () => {
    const mismatches: string[] = [];
    for (const table of Object.values(schema)) {
      if (!is(table, PgTable)) continue;
      const config = getTableConfig(table);
      for (const key of config.foreignKeys) {
        const reference = key.reference();
        const target = getTableConfig(reference.foreignTable);
        reference.columns.forEach((column, index) => {
          // Explicit foreignKey builders expose ExtraConfigColumn wrappers;
          // resolve the original column before asking for its SQL type.
          const sourceColumn = config.columns.find((item) => item.name === column.name)!;
          const targetColumn = target.columns.find(
            (item) => item.name === reference.foreignColumns[index]!.name
          )!;
          if (sourceColumn.getSQLType() !== targetColumn.getSQLType()) {
            mismatches.push(`${config.name}.${column.name} -> ${target.name}.${targetColumn.name}`);
          }
        });
      }
    }
    expect(mismatches).toEqual([]);
  });
});
