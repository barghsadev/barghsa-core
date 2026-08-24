import { describe, it, expect } from 'vitest'
import { getTableColumns } from 'drizzle-orm'
import { createTable } from './base-table'
import { text, integer } from 'drizzle-orm/pg-core'

describe('base table factory', () => {
  describe('createTable', () => {
    it('creates a table with base columns and domain columns', () => {
      const table = createTable('products', {
        name: text('name').notNull(),
        price: integer('price').notNull(),
      })

      const columns = getTableColumns(table)
      expect(columns['id']).toBeDefined()
      expect(columns['createdAt']).toBeDefined()
      expect(columns['updatedAt']).toBeDefined()
      expect(columns['name']).toBeDefined()
      expect(columns['price']).toBeDefined()
    })

    it('preserves domain column types', () => {
      const table = createTable('items', {
        sku: text('sku').notNull(),
        quantity: integer('quantity').default(0),
      })

      const columns = getTableColumns(table)
      expect(columns['sku']?.getSQLType()).toBe('text')
      expect(columns['sku']?.hasDefault).toBe(false)
      expect(columns['quantity']?.getSQLType()).toBe('integer')
      expect(columns['quantity']?.hasDefault).toBe(true)
    })

    it('accepts an empty columns object', () => {
      const table = createTable('metadata', {})

      const columns = getTableColumns(table)
      expect(columns['id']).toBeDefined()
      expect(columns['createdAt']).toBeDefined()
      expect(columns['updatedAt']).toBeDefined()
      expect(Object.keys(columns)).toEqual(['id', 'createdAt', 'updatedAt'])
    })
  })
})