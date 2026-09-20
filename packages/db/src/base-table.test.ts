import { describe, it, expect, expectTypeOf } from 'vitest';
import { getTableColumns } from 'drizzle-orm';
import { createTable } from './base-table';
import { text, integer } from 'drizzle-orm/pg-core';

describe('base table factory', () => {
  describe('createTable', () => {
    it('creates a table with base columns and domain columns', () => {
      const table = createTable('products', {
        name: text('name').notNull(),
        price: integer('price').notNull(),
      });

      const columns = getTableColumns(table);
      expect(columns['id']).toBeDefined();
      expect(columns['createdAt']).toBeDefined();
      expect(columns['updatedAt']).toBeDefined();
      expect(columns['name']).toBeDefined();
      expect(columns['price']).toBeDefined();
    });

    it('preserves domain column types', () => {
      const table = createTable('items', {
        sku: text('sku').notNull(),
        quantity: integer('quantity').default(0),
      });

      const columns = getTableColumns(table);
      expect(columns['sku']?.getSQLType()).toBe('text');
      expect(columns['sku']?.hasDefault).toBe(false);
      expect(columns['quantity']?.getSQLType()).toBe('integer');
      expect(columns['quantity']?.hasDefault).toBe(true);
    });

    it('accepts an empty columns object', () => {
      const table = createTable('metadata', {});

      const columns = getTableColumns(table);
      expect(columns['id']).toBeDefined();
      expect(columns['createdAt']).toBeDefined();
      expect(columns['updatedAt']).toBeDefined();
      expect(Object.keys(columns)).toEqual(['id', 'createdAt', 'updatedAt']);
    });

    it('infers domain column types at compile time', () => {
      const _table = createTable('type_test', {
        sku: text('sku').notNull(),
        quantity: integer('quantity').default(0),
      });

      // $ExpectType - verify the insert/select types are inferred
      type InsertColumns = typeof _table.$inferInsert;
      type SelectColumns = typeof _table.$inferSelect;

      // Verify domain columns exist in the inferred types
      expectTypeOf<InsertColumns>().toHaveProperty('sku');
      expectTypeOf<InsertColumns>().toHaveProperty('quantity');
      expectTypeOf<SelectColumns>().toHaveProperty('sku');
      expectTypeOf<SelectColumns>().toHaveProperty('quantity');
      expectTypeOf<InsertColumns['sku']>().toEqualTypeOf<string>();
      expectTypeOf<SelectColumns['quantity']>().toEqualTypeOf<number | null>();
      expectTypeOf<typeof _table._.name>().toEqualTypeOf<'type_test'>();
    });

    it('includes base columns in inferred insert/select types', () => {
      const _table = createTable('base_type_test', {
        name: text('name').notNull(),
      });

      type InsertColumns = typeof _table.$inferInsert;
      type SelectColumns = typeof _table.$inferSelect;

      expectTypeOf<InsertColumns>().toHaveProperty('id');
      expectTypeOf<InsertColumns>().toHaveProperty('createdAt');
      expectTypeOf<InsertColumns>().toHaveProperty('updatedAt');
      expectTypeOf<SelectColumns>().toHaveProperty('id');
      expectTypeOf<SelectColumns>().toHaveProperty('createdAt');
      expectTypeOf<SelectColumns>().toHaveProperty('updatedAt');
    });
  });
});
